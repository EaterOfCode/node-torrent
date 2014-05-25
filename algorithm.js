var util = require('util'),
    events = require("events");

var Algorithm = function(torrent) {
    events.EventEmitter.call(this);
    var len = this._len = torrent.data.info.pieces.length / 20;
    var bitFieldMap = this.bitFieldMap = new Array(len);
    for (var i = 0; i < len; i++) bitFieldMap[i] = 0;
    this.torrent = torrent;
    this._pieceLength = torrent.data.info['piece length'];
    this.runningRequests = [];
    this.unfinishedPieces = {};
    this.requestQueue = this.createQueue();
    var that = this;
    torrent.on('peer', function(peer) {
        peer.on('bitfield', function(bitfield) {
            for (var i = 0; i < len; i++) {
                if (bitfield.get(i)) {
                    bitFieldMap[i]++;
                }
            }
            peer.intrested();
            that.requestQueue = that.createQueue();
            that.bump();
        });
        peer.on('unchoked', function() {
            that.bump();
        });
        peer.on('have', function(index) {
            bitFieldMap[index]++;
            that.bump();
        });
        peer.on('piece', function(piece) {
            if (!that.unfinishedPieces[piece.index]) that.unfinishedPieces[piece.index] = [];
            that.unfinishedPieces[piece.index].push({
                length: piece.length,
                index: piece.index,
                offset: piece.offset
            });
            that.unfinishedPieces[piece.index] = that.connectBlocks(that.unfinishedPieces[piece.index]);
            if (that.unfinishedPieces[piece.index].length == 1 && that.unfinishedPieces[piece.index][0].offset == 0 && that.unfinishedPieces[piece.index][0].length == that.getPieceLength(piece.index)) {
                torrent.checkPiece(piece.index, function(yes) {
                    if (yes) {
                        that.torrent.bitfield.set(piece.index, true);
                        that.torrent.have(piece.index);
                        var good = true;
                        var missing = 0;
                        for (var i = 0; i < len; i++) {
                            if (!that.torrent.bitfield.get(i)) {
                                missing++;
                                good = false;
                            }
                        }
                        if (good) {
                            that.emit('done');
                        }
                    }
                    delete(that.unfinishedPieces[piece.index]);
                    that.requestQueue = that.createQueue();
                    that.bump();
                });
            }
            that.runningRequests.filter(function(a) {
                if (a.index == piece.index) {
                    if (a.offset >= piece.offset && a.offset <= (piece.length + piece.offset)) {
                        return true;
                    } else if ((a.offset + a.length) >= piece.offset && (a.offset + a.length) <= (piece.length + piece.offset)) {
                        return true;
                    } else return false;
                } else return false;
            }).forEach(function(a) {
                that.runningRequests.splice(that.runningRequests.indexOf(a), 1);
            });
            that.bump();
        });
        peer.on('end', function() {
            for (var i = 0; i < len; i++) {
                if (peer.bitfield.get(i)) {
                    bitFieldMap[i]--;
                }
            }
        });
    });

};

util.inherits(Algorithm, events.EventEmitter);

Algorithm.prototype.getPieceLength = function(index) {
    if (index == (this._len - 1)) {
        var p = this.torrent.data.length % this._pieceLength
        return p == 0 ? this._pieceLength : p;
    } else {
        return this._pieceLength;
    }
}

Algorithm.prototype.connectBlocks = function(blocks) {

    var fin = blocks.length == 0 ? [] : blocks.sort(function(a, b) {
        return a.offset > b.offset ? 1 : -1;
    }).reduce(function(a, b) {
        if (!Array.isArray(a)) a = [a];
        var p = a.pop();
        if (p.offset + p.length >= b.offset) {
            p.length = (b.offset - p.offset) + b.length;
            a.push(p);
        } else {
            a.push(p, b);
        }
        return a;
    });

    if (!Array.isArray(fin)) fin = [fin];
    return fin;
}

Algorithm.prototype.getGaps = function(blockArray, index) {

    blockArray = blockArray.sort(function(a, b) {
        return a.offset > b.offset ? 1 : -1;
    });
    var lastOffset = 0;
    var gaps = [];
    blockArray.forEach(function(a) {
        while (a.offset > lastOffset) {
            var b;
            gaps.push(b = {
                index: index,
                offset: lastOffset,
                length: Math.min(a.offset - lastOffset, Algorithm.requestSize)
            });
            lastOffset = b.offset + b.length;
        }
        lastOffset = a.offset + a.length;

    });
    var len = this.getPieceLength(index),
        a;
    if(index == 576) console.log(len, lastOffset);
    while (lastOffset < len) {
        gaps.push(a = {
            index: index,
            offset: lastOffset,
            length: Math.min(len - lastOffset, Algorithm.requestSize)
        });
        lastOffset = a.offset + a.length;
    }

    return gaps;
}

Algorithm.prototype.createQueue = function() {
    var blocks = this.unrequestedBlocks();
    //console.log(blocks);
    if (!blocks) {
        return [];
    } else {
        return this.selectBlocks(blocks);
    }
};

Algorithm.prototype.getOptimisticPiece = function(i) {
    var piece = [];
    if (this.unfinishedPieces[i]) {

        piece = [].concat(piece, this.unfinishedPieces[i]);
    }
    piece.push.apply(piece, this.runningRequests.filter(function(a) {
        return a.index == i;
    }));
    return this.connectBlocks(piece);
}

Algorithm.prototype.unrequestedBlocks = function() {
    var missing = [];
    for (var i = 0; i < this._len; i++) {
        if (!this.torrent.bitfield.get(i)) {
            var fin = this.getOptimisticPiece(i);

            if ((fin.length > 1 || fin.length == 0) || (fin[0].offset > 0 || fin[0].length < this.getPieceLength(i))) {
                missing.push(i);
            }
        }
    }
    return missing.length > 0 ? missing : false;
};

Algorithm.prototype.selectPeerByPiece = function(index) {
    var availPeers = this.torrent.peers.filter(function(a) {
        return a.bitfield.get(index) && !a.isChoked;
    });
    return availPeers[Math.floor(availPeers.length * Math.random())];
}

Algorithm.prototype.selectBlocks = function(blocks) {
    var bitFieldMap = this.bitFieldMap;
    var that = this;
    var gaps = blocks.sort(function(a, b) {
        return bitFieldMap[a] > bitFieldMap[b] ? 1 : bitFieldMap[a] < bitFieldMap[b] ? -1 : 0;
    }).filter(function(a) {
        return bitFieldMap[a] > 0;
    }).map(function(piece) {
        var optimisticPiece = that.getOptimisticPiece(piece);
        var gaps = that.getGaps(optimisticPiece, piece);
        return gaps;
    });
    return gaps.length > 0 ? gaps.reduce(function(a, b) {
        return b ? a.concat(b) : a;
    }) : [];
}

Algorithm.prototype.bump = function() {
    while (this.runningRequests.length < Algorithm.parallelRequests && this.requestQueue.length > 0) {
        var block = this.requestQueue.shift();
        var peer = this.selectPeerByPiece(block.index);
        if (peer) {
            peer.request(block.index, block.offset, block.length);
            block.peer = peer;
            this.runningRequests.push(block);
        } else {
            this.requestQueue.push(block);
            break;
        }
    }
};

Algorithm.parallelRequests = 20;
Algorithm.requestSize = 16384;

module.exports = Algorithm;
