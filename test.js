var Peer = require('./peer.js');
var Torrent = require('./torrent.js');

var net = require('utp');
var fs = require('fs');
/*
 
 */

var torrent = new Torrent('./test.torrent', './test.txt');
torrent.on("ready", function() {
    console.log(require('util').inspect(torrent, {
        colors: true,
        depth: null
    }))
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
        /*var deer = new Peer({
            port: 52069,
            host: 'localhost',
            hash: torrent.hash,
            bitfield: torrent.bitfield
        });
        deer.on('ready', function() {
            console.log(":D");
        })
        deer.on("error", function(err) {
            console.log(":c", err);
        });
        deer.on("end", function() {
            console.log(":|");
        });*/
    });
});
torrent.on('done', function() {
    net.close();
})