var Peer = require('./peer.js');
var Torrent = require('./torrent.js');

var net = require('utp');
var fs = require('fs');
/*

 */

var torrent = new Torrent('./test/folder.torrent', './test/result');
torrent.on("ready", function() {
    /*console.log(require('util').inspect(torrent, {
        colors: true,
        depth: null
    }))*/
    net.createServer(function(sock) {
        console.log("Client connected");
        var peer = new Peer({
            socket: sock,
            hash: torrent.hash,
            bitfield: torrent.bitfield
        });
        torrent.addPeer(peer);
        torrent.on('done', function() {
            sock.close();
        });
    }).listen(52069, function() {
        console.log("Listening at", '127.0.0.1:52069');
    });
});
torrent.on('done', function() {
    net.close();
})
