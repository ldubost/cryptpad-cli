function normalize(path) {
    if (!path) return '/';
    let p = path.replace(/\\/g, '/');
    if (!p.startsWith('/')) p = '/' + p;
    // collapse // and handle . and ..
    const parts = [];
    p.split('/').forEach(seg => {
        if (!seg || seg === '.') return;
        if (seg === '..') parts.pop(); else parts.push(seg);
    });
    return '/' + parts.join('/');
}

function join(a, b) {
    if (!b || b === '/') return normalize(a);
    if (b.startsWith('/')) return normalize(b);
    if (a.endsWith('/')) return normalize(a + b);
    return normalize(a + '/' + b);
}

function isSubPath(parent, child) {
    return child === parent || child.startsWith(parent.endsWith('/') ? parent : parent + '/');
}

function createDirectoryNode() {
    return { type: 'dir', children: new Map() };
}

function createFileNode(content = '') {
    return { type: 'file', content: String(content) };
}

function createMemoryAdapter(initial = {}) {
    const root = createDirectoryNode();

    function ensureDir(path) {
        const parts = normalize(path).split('/').filter(Boolean);
        let node = root;
        for (const seg of parts) {
            if (!node.children.has(seg)) node.children.set(seg, createDirectoryNode());
            const next = node.children.get(seg);
            if (next.type !== 'dir') throw new Error('Path part is a file: ' + seg);
            node = next;
        }
        return node;
    }

    function getNode(path) {
        const parts = normalize(path).split('/').filter(Boolean);
        let node = root;
        for (const seg of parts) {
            const next = node.children.get(seg);
            if (!next) return null;
            node = next;
        }
        return node;
    }

    function putFile(path, content = '') {
        const dir = ensureDir(require('path').posix.dirname(normalize(path)));
        const base = require('path').posix.basename(normalize(path));
        dir.children.set(base, createFileNode(content));
    }

    // seed initial structure
    Object.entries(initial).forEach(([path, value]) => {
        const npath = normalize(path);
        if (typeof value === 'string') {
            putFile(npath, value);
        } else {
            ensureDir(npath);
        }
    });

    async function stat(path) {
        const node = getNode(path);
        if (!node) return null;
        return { type: node.type };
    }

    async function list(path) {
        const node = getNode(path);
        if (!node) throw new Error('No such directory');
        if (node.type !== 'dir') throw new Error('Not a directory');
        return Array.from(node.children.keys()).sort();
    }

    async function readFile(path) {
        const node = getNode(path);
        if (!node || node.type !== 'file') throw new Error('No such file');
        return node.content;
    }

    async function changeDir(from, to) {
        const target = normalize(join(from, to));
        const node = getNode(target);
        if (!node) throw new Error('No such path');
        if (node.type !== 'dir') throw new Error('Not a directory');
        return target;
    }

    async function makeDir(path) {
        ensureDir(path);
    }

    return {
        normalize,
        join,
        isSubPath,
        stat,
        list,
        readFile,
        changeDir,
        makeDir,
    };
}

module.exports = { createMemoryAdapter };



