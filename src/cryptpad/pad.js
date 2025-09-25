// pad.js

const CpNetflux = require('chainpad-netflux');
const CpCrypto = require('chainpad-crypto');
const ChainPad = require('chainpad');
const Netflux = require("netflux-websocket");
const WebSocket = require("ws");

//cfg.onLocal
//cfg.onRemote
//cfg.onReady
//cfg.onInit
const getPad = (padUrl, wsUrl, cfg) => {
    const getNetwork = () => {
        const f = () => {
            return new WebSocket(wsUrl);
        };
        return Netflux.connect('', f);
    };

    const getKeys = url => {
        const u = new URL(url);
        let key = u.hash.split('/')[4];
        return CpCrypto.createEditCryptor2(key);
    };

    const base64ToHex = (b64String) => {
        const hexArray = [];
        atob(b64String.replace(/-/g, '/')).split("").forEach((e) => {
            let h = e.charCodeAt(0).toString(16);
            if (h.length === 1) { h = "0"+h; }
            hexArray.push(h);
        });
        return hexArray.join("");
    };

    const keys = getKeys(padUrl);
    const channel = base64ToHex(keys.chanId);
    const config = { 
        network: getNetwork(),
        channel: channel,
        crypto: CpCrypto.createEncryptor(keys),
        logLevel: 1,
        ChainPad: ChainPad
    };
    config.onReady = cfg.onReady;
    config.onLocal = cfg.onLocal;
    config.onRemote = cfg.onRemote;

    const rt = CpNetflux.start(config);

    return rt;

};

module.exports = { getPad }