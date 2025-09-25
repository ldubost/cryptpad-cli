const Listmap = require('chainpad-listmap');
const CpCrypto = require('chainpad-crypto');
const ChainPad = require('chainpad');
const Netflux = require("netflux-websocket");
const WebSocket = require("ws");

const driveUrl = 'http://localhost:3000/drive/#/2/drive/edit/4SH+XD5NqierGNeW5S3vHqbx/';

const getNetwork = () => {
    const f = () => {
        return new WebSocket('ws://localhost:3000/cryptpad_websocket');
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

const keys = getKeys(driveUrl);

const config = {
    network: getNetwork(),
    channel: base64ToHex(keys.chanId),
    data: {},
    validateKey: keys.validateKey, // derived validation key
    crypto: CpCrypto.createEncryptor(keys),
    logLevel: 1,
    classic: true,
    ChainPad: ChainPad
};


const rt = Listmap.create(config);
rt.proxy.on('ready', () => {
    console.log('READY');
    console.log(rt.proxy);
}).on('error', (info) => {
    console.error('ERROR');
    console.error(info);
});

console.log(rt);

// Keep alive
setInterval(() => {}, 1 << 30);
