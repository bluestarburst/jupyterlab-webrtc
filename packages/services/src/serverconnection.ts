// Copyright (c) Jupyter Development Team.
// Distributed under the terms of the Modified BSD License.

import { PageConfig, URLExt } from '@jupyterlab/coreutils';
import { KernelMessage } from './kernel';
import { deserialize, serialize } from './kernel/serialize';
import { WebRTC } from './webrtc';

interface ISerializer {
  /**
   * Serialize a kernel message for transport.
   */
  serialize(
    msg: KernelMessage.IMessage,
    protocol?: string
  ): string | ArrayBuffer;
  /**
   * Deserialize and return the unpacked message.
   */
  deserialize(data: ArrayBuffer, protocol?: string): KernelMessage.IMessage;
}

/**
 * The namespace for ServerConnection functions.
 *
 * #### Notes
 * This is only intended to manage communication with the Jupyter server.
 *
 * The default values can be used in a JupyterLab or Jupyter Notebook context.
 *
 * We use `token` authentication if available, falling back on an XSRF
 * cookie if one has been provided on the `document`.
 *
 * A content type of `'application/json'` is added when using authentication
 * and there is no body data to allow the server to prevent malicious forms.
 */
export namespace ServerConnection {
  /**
   * A Jupyter server settings object.
   * Note that all of the settings are optional when passed to
   * [[makeSettings]]. The default settings are given in [[defaultSettings]].
   */
  export interface ISettings {
    /**
     * The base url of the server.
     */
    readonly baseUrl: string;

    /**
     * The app url of the JupyterLab application.
     */
    readonly appUrl: string;

    /**
     * The base ws url of the server.
     */
    readonly wsUrl: string;

    /**
     * The default request init options.
     */
    readonly init: RequestInit;

    /**
     * The authentication token for requests.  Use an empty string to disable.
     */
    readonly token: string;

    /**
     * Whether to append a token to a Websocket url.  The default is `false` in the browser
     * and `true` in node or jest.
     */
    readonly appendToken: boolean;

    /**
     * The `fetch` method to use.
     */
    readonly fetch: (
      input: RequestInfo,
      init?: RequestInit
    ) => Promise<Response>;

    /**
     * The `Request` object constructor.
     */
    readonly Request: typeof Request;

    /**
     * The `Headers` object constructor.
     */
    readonly Headers: typeof Headers;

    /**
     * The `WebSocket` object constructor.
     */
    readonly WebSocket: typeof WebSocket;

    /**
     * Serializer used to serialize/deserialize kernel messages.
     */
    readonly serializer: ISerializer;
  }

  /**
   * Create a settings object given a subset of options.
   *
   * @param options - An optional partial set of options.
   *
   * @returns The full settings object.
   */
  export function makeSettings(options?: Partial<ISettings>): ISettings {
    return Private.makeSettings(options);
  }

  /**
   * Make an request to the notebook server.
   *
   * @param url - The url for the request.
   *
   * @param init - The initialization options for the request.
   *
   * @param settings - The server settings to apply to the request.
   *
   * @returns a Promise that resolves with the response.
   *
   * @throws If the url of the request is not a notebook server url.
   *
   * #### Notes
   * The `url` must start with `settings.baseUrl`.  The `init` settings are
   * merged with `settings.init`, with `init` taking precedence.
   * The headers in the two objects are not merged.
   * If there is no body data, we set the content type to `application/json`
   * because it is required by the Notebook server.
   */
  export async function makeRequest(
    url: string,
    init: RequestInit,
    settings: ISettings
  ): Promise<Response> {
    // Handle notebook server requests.
    if (url.indexOf(settings.baseUrl) !== 0) {
      throw new Error('Can only be used for notebook server requests');
    }

    // Use explicit cache buster when `no-store` is set since
    // not all browsers use it properly.
    const cache = init.cache ?? settings.init.cache;
    if (cache === 'no-store') {
      url += (/\?/.test(url) ? '&' : '?') + new Date().getTime();
    }

    const request = new settings.Request(url, { ...settings.init, ...init });

    // Handle authentication
    let authenticated = false;
    if (settings.token) {
      authenticated = true;
      request.headers.append('Authorization', `token ${settings.token}`);
    }
    if (typeof document !== 'undefined') {
      const xsrfToken = getCookie('_xsrf');
      if (xsrfToken !== undefined) {
        authenticated = true;
        request.headers.append('X-XSRFToken', xsrfToken);
      }
    }

    // Set the content type if there is no given data and we are
    // using an authenticated connection.
    if (!request.headers.has('Content-Type') && authenticated) {
      request.headers.set('Content-Type', 'application/json');
    }

    // Convert request to WebRTC message
    const method = init.method || 'GET';
    const body = init.body ? JSON.parse(init.body as string) : {};

    // Send request through WebRTC
    WebRTC.sendMessage('sudo_http_request', {
      url: url.replace(settings.baseUrl, ''),
      method,
      body
    });

    // Wait for response
    return new Promise((resolve, reject) => {
      const responseHandler = (data: any) => {
        WebRTC.removeActionListener('sudo_http_response', responseHandler);
        const responseObject = new Response(data.data, {
          status: data.status,
          headers: data.headers
        });
        resolve(responseObject);
      };

      WebRTC.addActionListener('sudo_http_response', responseHandler);
    });
  }

  /**
   * A wrapped error for a fetch response.
   */
  export class ResponseError extends Error {
    /**
     * Create a ResponseError from a response, handling the traceback and message
     * as appropriate.
     *
     * @param response The response object.
     *
     * @returns A promise that resolves with a `ResponseError` object.
     */
    static async create(response: Response): Promise<ResponseError> {
      try {
        const data = await response.json();
        const { message, traceback } = data;
        if (traceback) {
          console.error(traceback);
        }
        return new ResponseError(
          response,
          message ?? ResponseError._defaultMessage(response),
          traceback ?? ''
        );
      } catch (e) {
        console.debug(e);
        return new ResponseError(response);
      }
    }

    /**
     * Create a new response error.
     */
    constructor(
      response: Response,
      message = ResponseError._defaultMessage(response),
      traceback = ''
    ) {
      super(message);
      this.response = response;
      this.traceback = traceback;
    }

    /**
     * The response associated with the error.
     */
    response: Response;

    /**
     * The traceback associated with the error.
     */
    traceback: string;

    private static _defaultMessage(response: Response): string {
      return `Invalid response: ${response.status} ${response.statusText}`;
    }
  }

  /**
   * A wrapped error for a network error.
   */
  export class NetworkError extends TypeError {
    /**
     * Create a new network error.
     */
    constructor(original: TypeError) {
      super(original.message);
      this.stack = original.stack;
    }
  }
}

/**
 * The namespace for module private data.
 */
namespace Private {
  /**
   * Handle the server connection settings, returning a new value.
   */
  export function makeSettings(
    options: Partial<ServerConnection.ISettings> = {}
  ): ServerConnection.ISettings {
    const pageBaseUrl = PageConfig.getBaseUrl();
    const pageWsUrl = PageConfig.getWsUrl();
    const baseUrl = URLExt.normalize(options.baseUrl) || pageBaseUrl;
    let wsUrl = options.wsUrl;
    // Prefer the default wsUrl if we are using the default baseUrl.
    if (!wsUrl && baseUrl === pageBaseUrl) {
      wsUrl = pageWsUrl;
    }
    // Otherwise convert the baseUrl to a wsUrl if possible.
    if (!wsUrl && baseUrl.indexOf('http') === 0) {
      wsUrl = 'ws' + baseUrl.slice(4);
    }
    // Otherwise fall back on the default wsUrl.
    wsUrl = wsUrl ?? pageWsUrl;

    const appendTokenConfig = PageConfig.getOption('appendToken').toLowerCase();
    let appendToken;
    if (appendTokenConfig === '') {
      appendToken =
        typeof window === 'undefined' ||
        (typeof process !== 'undefined' &&
          process?.env?.JEST_WORKER_ID !== undefined) ||
        URLExt.getHostName(pageBaseUrl) !== URLExt.getHostName(wsUrl);
    } else {
      appendToken = appendTokenConfig === 'true';
    }

    return {
      init: { cache: 'no-store', credentials: 'same-origin' },
      fetch,
      Headers,
      Request,
      WebSocket,
      token: PageConfig.getToken(),
      appUrl: PageConfig.getOption('appUrl'),
      appendToken,
      serializer: { serialize, deserialize },
      ...options,
      baseUrl,
      wsUrl
    };
  }
}

/**
 * Get a cookie from the document.
 */
function getCookie(name: string): string | undefined {
  // From http://www.tornadoweb.org/en/stable/guide/security.html
  let cookie = '';
  try {
    cookie = document.cookie;
  } catch (e) {
    // e.g. SecurityError in case of CSP Sandbox
    return;
  }
  const matches = cookie.match('\\b' + name + '=([^;]*)\\b');
  return matches?.[1];
}
