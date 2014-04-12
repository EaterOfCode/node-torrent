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
    var that = this;
    torrent.on('peer', function(peer) {
        peer.on('bitfield', function(bitfield) {
            for (var i = 0; i < len; i++) {
                if (bitfield.get(i)) {
                    bitFieldMap[i]++;
                }
            }
            peer.intrested();
            that.bump();
        });
        peer.on('unchoked', function() {
            that.bump();
        });
        peer.on('have', function(index) {
            //if (index > 783) {
            //}
            bitFieldMap[index]++;
            //console.log(bitFieldMap, index);
            that.bump();
        });
        peer.on('piece', function(piece) {
            // algorithm only needs to handle requests not file writing
            if (!that.unfinishedPieces[piece.index]) that.unfinishedPieces[piece.index] = [];
            that.unfinishedPieces[piece.index].push({
                length: piece.length,
                index: piece.index,
                offset: piece.offset
            });
            if (piece.index == 785) {
                console.log('unfinished before connect', that.unfinishedPieces[piece.index]);
            }
            that.unfinishedPieces[piece.index] = that.connectBlocks(that.unfinishedPieces[piece.index]);
            if (piece.index == 785) {
                console.log('unfinished after connect', that.unfinishedPieces[piece.index]);
                console.log('running reqs', that.runningRequests.filter(function(a) {
                    a.index == 785
                }));
            }
            if (that.unfinishedPieces[piece.index].length == 1 && that.unfinishedPieces[piece.index][0].offset == 0 && that.unfinishedPieces[piece.index][0].length == that.getPieceLength(piece.index)) {
                that.torrent.bitfield.set(piece.index, true);
                that.torrent.have(piece.index);
                delete(that.unfinishedPieces[piece.index]);
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
            var good = true;
            var missing = 0;
            for (var i = 0; i < len; i++) {
                if (!that.torrent.bitfield.get(i)) {
                    missing++;
                    good = false;
                }
            }
            //console.log((100 - ((missing / len) * 100)) + '%', that.torrent._queuedWrites.length) //, that.unfinishedPieces, that.runningRequests);
            if (good) {
                //console.log(that.unrequestedBlocks());
                this.emit('done');
            } else {
                that.bump();
            }
        });
    });

};

util.inherits(Algorithm, events.EventEmitter);

Algorithm.prototype.getPieceLength = function(index) {
    if (index == (this._len - 1)) {
        var p = this.torrent.data.info.length % this._pieceLength
        return p == 0 ? this._pieceLength : p;
    } else {
        return this._pieceLength;
    }
}

Algorithm.prototype.connectBlocks = function(blocks) {
    //  console.log(blocks);
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
    //console.log(blocks, fin);
    if (!Array.isArray(fin)) fin = [fin];
    return fin;
}

Algorithm.prototype.getGaps = function(blockArray, index) {
    //  console.log(blockArray);
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
    while (lastOffset < len) {
        gaps.push(a = {
            index: index,
            offset: lastOffset,
            length: Math.min(len - lastOffset, Algorithm.requestSize)
        });
        lastOffset = a.offset + a.length;
    }
    //if (this.di) process.exit();
    return gaps;
}

Algorithm.prototype.getOptimisticPiece = function(i) {
    var piece = [];
    if (this.unfinishedPieces[i]) {
        // bugger line
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
            // console.log(fin);
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
    var rarestPieceIndex = blocks.sort(function(a, b) {
        return bitFieldMap[a] > bitFieldMap[b] ? 1 : bitFieldMap[a] < bitFieldMap[b] ? -1 : 0;
    }).filter(function(a) {
        //console.log(a, bitFieldMap[a]);
        return bitFieldMap[a] > 0;
    }).shift();
    if (rarestPieceIndex === undefined) {
        return false;
    }
    var optimisticPiece = this.getOptimisticPiece(rarestPieceIndex);
    var gaps = this.getGaps(optimisticPiece, rarestPieceIndex);
    return gaps;
}

Algorithm.prototype.bump = function() {
    var todo;
    runForrestRun: while (this.runningRequests.length < Algorithm.parallelRequests && (todo = this.unrequestedBlocks())) {
        var blocks = this.selectBlocks(todo);
        //console.log(block);
        if (!blocks.length > 0) break;
        for (var i = 0; i < blocks.length && this.runningRequests.length < Algorithm.parallelRequests; i++) {
            var peer = this.selectPeerByPiece(blocks[i].index);
            if (peer) {
                //console.log('Reque', blocks[i].index, blocks[i].offset);
                peer.request(blocks[i].index, blocks[i].offset, blocks[i].length);
                blocks.peer = peer;
                this.runningRequests.push(blocks[i]);
            } else break runForrestRun;
        }
    }
};

Algorithm.parallelRequests = 20;
Algorithm.requestSize = 16384;

module.exports = Algorithm;