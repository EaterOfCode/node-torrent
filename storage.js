var fs = require('fs');
var path = require('path');
var mkdirp = require('mkdirp');

var Storage = function(data,targetFolder){
    this.target = targetFolder;
    this.data = data;
    this._writeQueue = [];
    this._running = false;
    this.files = this.data.info.files?this.data.info.files.map(function(f){
        return {
            path:f.path,
            length:f.length
        };
    }):[{
            path:[this.data.info.name],
            length:this.data.info.length
    }];
};

Storage.prototype = {
    get:function(index,offset,length,callback){
        if(typeof(offset) == 'function'){
            callback = offset;
            offset = false;
        }
        offset = offset||0;
        length = length||(this.getLength(index)-offset);
        var filesToRead = this.getFiles(index,offset,length);
        var massBuff = new Buffer(length);
        var i = 0;
        var that = this;
        var bOffset = 0;
        var read = function(){
            var file = filesToRead[i++];
            that._read(file.file,massBuff,bOffset,file.length,file.offset,function(err){
                bOffset += file.length;
                if(err){
                    callback(err);
                    return;
                }
                if(i < filesToRead.length){
                    read();
                }else{
                    callback(null,massBuff);
                }
            });
        };
        read();
    },
    getLength:function(index){
        var pl = this.data.info['piece length'];
        if (index == ((this.data.info.pieces.length / 20) - 1) && (this.data.length % pl) !== 0) pl = (this.data.length % pl);
        return pl;
    },
    set:function(block){
        var filesToWrite = this.getFiles(block.index,block.offset,block.block.length),
            offset = 0;
        [].push.apply(this._writeQueue,filesToWrite.map(function(file){
            var buff = block.block.slice(offset,offset + file.length);
            offset+=file.length
            return {
                pBuffer: {
                    offset:file.offset,
                    data:buff
                },
                index:block.index,
                fileObj:file.file
            };
        }));

        this._do();
    },
    isWriting:function(index){
        return index===undefined?this._running:this._writeQueue.filter(function(item){
            return item.index === index;
        }).length > 0;
    },
    _do:function(){
        if(!this._running){
            this._running = true;
            var that = this;
            var punch = function(){
                if(that._writeQueue.length > 0){
                    var w = that._writeQueue.shift();
                    that._writeToFile(w.pBuffer,w.fileObj,function(err){
                        if(err){
                            // TODO: Error handling;
                        }
                        punch();
                    });
                }else{
                    that._running = false;
                }
            }
            punch();
        }
    },
    getFiles:function(index,offset,length){
        length = length||(this.getLength(index)-offset);
        offset = (index * this.data.info['piece length']) + (offset||0);
        var buildedOffset = 0;
        var writeOffset = false;
        var selected=[];
        var files = this.data.info.files;
        for(var i=0;i<files.length;i++){
            buildedOffset += files[i].length;
            if(offset < buildedOffset){
                var obj = {
                    offset:0,
                    file:files[i],
                    length: 0
                };
                if(writeOffset === false) obj.offset = writeOffset = offset - (buildedOffset-files[i].length);
                obj.length = Math.min(files[i].length ,(offset + length) - (buildedOffset - files[i].length)) - obj.offset;
                selected.push(obj);
                if(buildedOffset >= (length+offset)){
                    break;
                }
            }
        }
        return selected;
    },
    _openfile: function(fileObj, callback){
        console.log(fileObj,[this.target].concat(fileObj.path));
        var totalPath = path.join.apply(path,[this.target].concat(fileObj.path));
        var baseDir = path.dirname(totalPath);
        mkdirp(baseDir,function(err){
            if(err){
                callback(err);
                return;
            }
            fs.open(totalPath,'w+',function(err,fd){
                if(err){
                    callback(err);
                    return;
                }
                fileObj._fd = fd;
                callback(null);
            });
        });
    },
    _read:function(fileObj,buffer,offset,length,position,callback){
        var that = this;
        if(!fileObj._fd){
            this._openfile(fileObj, function(err){
                if(err){
                    callback(err);
                    return;
                }
                fs.read(fileObj._fd,buffer,offset,length,position,callback);
            });
            return;
        }
        fs.read(fileObj._fd,buffer,offset,length,position,callback);
    },
    _writeToFile:function(pBuffer, fileObj,callback){
        var that = this;
        if(!fileObj._fd){
            this._openfile(fileObj, function(err){
                if(err){
                    callback(err);
                    return;
                }
                that._writeToFile(pBuffer,fileObj, callback);
            });
            return;
        }
        var totWritten = 0;
        var write = function(){
            fs.write(fileObj._fd,pBuffer.data, totWritten, pBuffer.data.length - totWritten, pBuffer.offset+totWritten,function(err,written){
                if(err){
                    callback(err);
                    return;
                }
                totWritten += written;
                if(pBuffer.data.length > totWritten){
                    write();
                }else{
                    callback(null);
                }
            });
        };
        write();
    }
};

module.exports = Storage;
