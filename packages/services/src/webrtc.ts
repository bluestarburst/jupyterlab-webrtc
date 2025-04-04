
export class WebRTC {
    private static instance: WebRTC;

    private constructor() { }

    peerConnection: RTCPeerConnection | undefined;
    dataChannel: RTCDataChannel | undefined;

    static getInstance(): WebRTC {
        if (!WebRTC.instance) {
            WebRTC.instance = new WebRTC();
        }
        return WebRTC.instance;
    }

    actionListeners: { [key: string]: Set<(data: any) => void> } = {};

    static addActionListener(action: string, callback: (data: any) => void) {
        const instance = WebRTC.getInstance();
        const set = instance.actionListeners[action] || new Set();
        set.add(callback);
        instance.actionListeners[action] = set;
    }

    static removeActionListener(action: string, callback: (data: any) => void) {
        const instance = WebRTC.getInstance();
        const set = instance.actionListeners[action];
        if (set) {
            set.delete(callback);
        }
    }

    messageHandler(event: MessageEvent) {
        const instance = WebRTC.getInstance();
        const data = JSON.parse(event.data);
        const set = instance.actionListeners[data.action];
        if (set) {
            set.forEach((callback) => callback(data.data));
        }
    }

    static async setDataChannel(dataChannel: RTCDataChannel) {
        const instance = WebRTC.getInstance();
        instance.dataChannel = dataChannel;
        instance.dataChannel.onmessage = instance.messageHandler;

        // instance.ipySessionContext = await createSessionContext();

        // await instance.ipySessionContext.initialize();


        // // get the running kernel connection
        // const kernelConnection = instance.ipySessionContext.session?.kernel as WebRTCKernelConnection;
        // console.log("Kernel Connection", kernelConnection);

        // WidgetManager.createInstance(kernelConnection as any);


        // instance.ipySessionContext.session = instance.ipySessionContext.sessionManager.running().next().value;

        // // create webrtcservice manager
        // instance.webrtcServiceManager = new WebRTCServiceManager({
        //     standby: 'never'
        // });

        // // wait until a kernel is available
        // while (!instance.webrtcServiceManager.sessions.running().next().value) {
        //     await new Promise(resolve => setTimeout(resolve, 1000));
        // }

        // // get the first session
        // const session = instance.webrtcServiceManager.sessions.running().next().value;
        // console.log("Session", session);

        // // connect to the kernel
        // const kernelConnection = instance.webrtcServiceManager.sessions.connectTo({
        //     model: session
        // });
        // console.log("Kernel Connection", kernelConnection);

    }

    static setPeerConnection(peerConnection: RTCPeerConnection) {
        const instance = WebRTC.getInstance();
        instance.peerConnection = peerConnection;
    }

    static sendMessage(action: string, data: any) {
        const instance = WebRTC.getInstance();
        instance.dataChannel?.send(JSON.stringify({ action, ...data }));
    }

}
