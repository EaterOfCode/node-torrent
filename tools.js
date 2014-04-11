module.exports = {
    bufferToString: function(o, encoding, blacklist) {
        blacklist = blacklist || [];
        for (var i in o) {
            if (o[i].__proto__ == Buffer.prototype) {
                if (blacklist.indexOf(i) == -1) {
                    o[i] = o[i].toString(encoding);
                }
            } else if (typeof(o[i] == "object")) {
                o[i] = this.bufferToString(o[i], encoding, blacklist);
            }
        }
        return o;
    }
}