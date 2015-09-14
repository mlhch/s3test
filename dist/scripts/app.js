(function() {
  window.upload = function(file) {
    return S3.upload(file, 'test/' + file.name, function(error, data) {
      if (error) {
        return console.error(error);
      }
      return console.log(data);
    }, function(info) {
      var loadedSize, parts, percent, progress, totalSize;
      if (info.loaded === true) {

      } else if ('number' === typeof info.loaded) {
        loadedSize = filesize(info.loaded, {
          unix: true
        });
        totalSize = filesize(file.size, {
          unix: true
        });
        percent = Math.floor(info.loaded * 10000 / file.size) / 100 + '%';
        progress = '[' + loadedSize + '/' + totalSize + '] ' + percent;
      }
      parts = info.parts ? info.parts.map(function(part) {
        return part.percent;
      }).join(' ') : '-';
      console.log([progress, parts]);
      return document.getElementById('log').innerHTML = [progress, parts].join(' ');
    });
  };

  document.body.onload = function() {
    S3.listObjects({
      Prefix: 'test/'
    }, function(error, data) {
      var html;
      if (error) {
        return console.error(error);
      }
      html = [];
      html.push('<ul>');
      data.Contents.forEach(function(row) {
        return html.push('<li>' + row.Key + ' (' + (filesize(row.Size, {
          unix: true
        })) + ')</li>');
      });
      html.push('</ul>');
      return document.getElementById('uploaded-files').innerHTML = html.join('');
    });
    return S3.listMultipartUploads({
      Prefix: 'test/'
    }, function(error, data) {
      var html;
      if (error) {
        return console.error(error);
      }
      console.log(data);
      html = [];
      html.push('<ul>');
      return Q.all(data.Uploads.map(function(row) {
        return Q.nfcall(function(cb) {
          return S3.listParts({
            Key: row.Key,
            UploadId: row.UploadId
          }, function(error, data) {
            var i, len, part, ref, uploadedSize;
            if (error) {
              return cb(error);
            }
            console.log(row.Key, data);
            uploadedSize = 0;
            ref = data.Parts;
            for (i = 0, len = ref.length; i < len; i++) {
              part = ref[i];
              uploadedSize += part.Size;
            }
            return cb(null, uploadedSize);
          });
        }).then(function(size) {
          return html.push('<li>' + row.Key + '(' + (filesize(size, {
            unix: true
          })) + ' uploaded)</li>');
        });
      })).then(function() {
        html.push('</ul>');
        return document.getElementById('uploading-files').innerHTML = html.join('');
      });
    });
  };

}).call(this);

(function() {
  var $config, TAG, bucket;

  AWS.config.update({
    accessKeyId: 'AKIAJQJUR7OMQKPHEPZA',
    secretAccessKey: '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'
  });

  bucket = new AWS.S3({
    params: {
      Bucket: 'transfer.tesera.com'
    },
    httpOptions: {
      timeout: 0
    }
  });

  TAG = '[testing] -';

  $config = {
    mpuMinSize: 50 * 1024 * 1024,
    mpuPartSize: function(size) {
      var G, M;
      M = Math.pow(1024, 2);
      G = Math.pow(1024, 3);
      switch (false) {
        case !(size >= 50 * G):
          return 0.5 * G;
        case !(size >= 5 * G):
          return 0.1 * G;
        case !(size >= 500 * M):
          return 20 * M;
        default:
          return 5 * M;
      }
    },
    maxUploadingFilesNumber: 3,
    maxUploadingPartsNumber: 5
  };

  bucket.upload = function(file, more) {
    if (!file.UploadId && file.size < $config.mpuMinSize) {
      return this.uploadSmall.apply(this, arguments);
    } else {
      return this.uploadMultipartLarge.apply(this, arguments);
    }
  };

  bucket.uploadSmall = function(file, key, callback, notify) {
    var params, req;
    console.log(TAG, ['uploadSmall', key]);
    params = {
      Key: key,
      ContentType: file.type,
      Body: file
    };
    return req = bucket.putObject(params, callback).on('httpUploadProgress', function(event) {
      return notify({
        loaded: event.loaded,
        req: req
      });
    }).on('retry', function(res) {
      if (res.error) {
        return res.error.retryable = false;
      }
    });
  };

  bucket.uploadMultipartLarge = function(file, key, callback, notify) {
    var _uploadLarge, mpuPartSize;
    console.log(TAG, ['uploadMultipartLarge', key]);
    mpuPartSize = $config.mpuPartSize(file.size);
    _uploadLarge = function(UploadId, PartNumbers, callback) {
      var complete, failureQueue, getPart, k, part, partIndex, queue, queueParts, totalUploadedSize, uploadPart;
      queue = [];
      failureQueue = [];
      partIndex = 0;
      totalUploadedSize = 0;
      for (k in PartNumbers) {
        part = PartNumbers[k];
        totalUploadedSize += part.Size;
      }
      queueParts = function() {
        while (queue.length < $config.maxUploadingPartsNumber) {
          if (part = failureQueue.shift()) {
            uploadPart(part);
            continue;
          }
          if (part = getPart(partIndex++)) {
            if (PartNumbers[part.PartNumber]) {
              continue;
            }
            uploadPart(part);
          } else {
            break;
          }
        }
        console.log(TAG, 'parts queue:', queue.map(function(part) {
          return part.PartNumber;
        }));
        if (!part && 0 === queue.length) {
          return complete();
        }
      };
      getPart = function(index) {
        var end, start;
        start = index * mpuPartSize;
        if (start >= file.size) {
          return part = false;
        } else {
          end = Math.min(start + mpuPartSize, file.size);
          return part = {
            PartNumber: index + 1,
            start: start,
            size: end - start,
            end: end,
            percent: 0,
            loaded: 0
          };
        }
      };
      uploadPart = function(part) {
        queue.push(part);
        return part.req = bucket.uploadPart({
          Key: key,
          Body: file.slice(part.start, part.end),
          ContentLength: part.size,
          PartNumber: part.PartNumber,
          UploadId: UploadId
        }, function(error, data) {
          var index;
          if (-1 !== (index = queue.indexOf(part))) {
            queue.splice(index, 1);
          }
          part.req = null;
          if (error) {
            console.error("File " + file.name + "(part " + part.PartNumber + ") upload failure: " + error.message + " at " + error.hostname);
            part.error = error;
            failureQueue.push(part);
            notify({
              loaded: totalUploadedSize
            });
            if (0 === queue.length) {
              return complete();
            }
          } else {
            console.log(TAG, ['uploadPart success', file.name, 'part', part.PartNumber]);
            totalUploadedSize += part.size;
            part = null;
            return queueParts();
          }
        }).on('httpUploadProgress', function(event) {
          var allPartsLoaded;
          part.loaded = event.loaded;
          part.percent = Math.floor(part.loaded * 100 / part.size) + '%';
          allPartsLoaded = 0;
          queue.forEach(function(part) {
            return allPartsLoaded += part.loaded;
          });
          return notify({
            loaded: totalUploadedSize + allPartsLoaded,
            parts: queue
          });
        });
      };
      complete = function() {
        console.log(TAG, ['uploadLarge', 'complete', failureQueue]);
        if (failureQueue.length) {
          return callback({
            message: 'Some parts upload failure due to: ' + failureQueue[0].error.message
          });
        }
        notify({
          loaded: true
        });
        return bucket.listParts({
          Key: key,
          UploadId: UploadId
        }, function(error, data) {
          if (error) {
            return console.log(error);
          }
          return bucket.completeMultipartUpload({
            Key: key,
            UploadId: UploadId,
            MultipartUpload: {
              Parts: data.Parts.map(function(part) {
                return {
                  ETag: part.ETag,
                  PartNumber: part.PartNumber
                };
              })
            }
          }, function(error) {
            console.log(TAG, ['uploadLarge', 'completeMultipartUpload', 'error:', error]);
            return callback(error);
          });
        });
      };
      return queueParts();
    };
    return bucket.listMultipartUploads({
      Prefix: key
    }, function(error, data) {
      var UploadId, Uploads;
      if (error) {
        return callback(error);
      }
      Uploads = data.Uploads;
      if (Uploads.length) {
        UploadId = Uploads.pop().UploadId;
        console.log(TAG, ['uploadLarge', 'listParts...']);
        return bucket.listParts({
          Key: key,
          UploadId: UploadId
        }, function(error, data) {
          var PartNumbers, i, len, part, ref;
          console.log(TAG, ['uploadLarge', 'listParts...', data && data.Parts || error]);
          if (error) {
            return callback(error);
          }
          PartNumbers = {};
          ref = data.Parts;
          for (i = 0, len = ref.length; i < len; i++) {
            part = ref[i];
            PartNumbers[part.PartNumber] = part;
          }
          return _uploadLarge(UploadId, PartNumbers, function(error) {
            var j, len1, row;
            for (j = 0, len1 = Uploads.length; j < len1; j++) {
              row = Uploads[j];
              bucket.abortMultipartUpload({
                Key: key,
                UploadId: row.UploadId
              }, function(error) {
                return console.log(TAG, [
                  'clean abortMultipartUpload', {
                    error: error
                  }
                ]);
              });
            }
            return callback(error);
          });
        });
      } else {
        console.log(TAG, ['uploadLarge', 'createMultipartUpload...']);
        return bucket.createMultipartUpload({
          Key: key
        }, function(error, data) {
          console.log(TAG, ['uploadLarge', 'createMultipartUpload', 'error:', error]);
          if (error) {
            return callback(error);
          }
          return _uploadLarge(data.UploadId, {}, callback);
        });
      }
    });
  };

  window.S3 = bucket;

}).call(this);

//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJzb3VyY2VzIjpbImFwcC5qcyIsInMzLmpzIl0sIm5hbWVzIjpbXSwibWFwcGluZ3MiOiJBQUFBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQ3pGQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0EiLCJmaWxlIjoiYXBwLmpzIiwic291cmNlc0NvbnRlbnQiOlsiKGZ1bmN0aW9uKCkge1xuICB3aW5kb3cudXBsb2FkID0gZnVuY3Rpb24oZmlsZSkge1xuICAgIHJldHVybiBTMy51cGxvYWQoZmlsZSwgJ3Rlc3QvJyArIGZpbGUubmFtZSwgZnVuY3Rpb24oZXJyb3IsIGRhdGEpIHtcbiAgICAgIGlmIChlcnJvcikge1xuICAgICAgICByZXR1cm4gY29uc29sZS5lcnJvcihlcnJvcik7XG4gICAgICB9XG4gICAgICByZXR1cm4gY29uc29sZS5sb2coZGF0YSk7XG4gICAgfSwgZnVuY3Rpb24oaW5mbykge1xuICAgICAgdmFyIGxvYWRlZFNpemUsIHBhcnRzLCBwZXJjZW50LCBwcm9ncmVzcywgdG90YWxTaXplO1xuICAgICAgaWYgKGluZm8ubG9hZGVkID09PSB0cnVlKSB7XG5cbiAgICAgIH0gZWxzZSBpZiAoJ251bWJlcicgPT09IHR5cGVvZiBpbmZvLmxvYWRlZCkge1xuICAgICAgICBsb2FkZWRTaXplID0gZmlsZXNpemUoaW5mby5sb2FkZWQsIHtcbiAgICAgICAgICB1bml4OiB0cnVlXG4gICAgICAgIH0pO1xuICAgICAgICB0b3RhbFNpemUgPSBmaWxlc2l6ZShmaWxlLnNpemUsIHtcbiAgICAgICAgICB1bml4OiB0cnVlXG4gICAgICAgIH0pO1xuICAgICAgICBwZXJjZW50ID0gTWF0aC5mbG9vcihpbmZvLmxvYWRlZCAqIDEwMDAwIC8gZmlsZS5zaXplKSAvIDEwMCArICclJztcbiAgICAgICAgcHJvZ3Jlc3MgPSAnWycgKyBsb2FkZWRTaXplICsgJy8nICsgdG90YWxTaXplICsgJ10gJyArIHBlcmNlbnQ7XG4gICAgICB9XG4gICAgICBwYXJ0cyA9IGluZm8ucGFydHMgPyBpbmZvLnBhcnRzLm1hcChmdW5jdGlvbihwYXJ0KSB7XG4gICAgICAgIHJldHVybiBwYXJ0LnBlcmNlbnQ7XG4gICAgICB9KS5qb2luKCcgJykgOiAnLSc7XG4gICAgICBjb25zb2xlLmxvZyhbcHJvZ3Jlc3MsIHBhcnRzXSk7XG4gICAgICByZXR1cm4gZG9jdW1lbnQuZ2V0RWxlbWVudEJ5SWQoJ2xvZycpLmlubmVySFRNTCA9IFtwcm9ncmVzcywgcGFydHNdLmpvaW4oJyAnKTtcbiAgICB9KTtcbiAgfTtcblxuICBkb2N1bWVudC5ib2R5Lm9ubG9hZCA9IGZ1bmN0aW9uKCkge1xuICAgIFMzLmxpc3RPYmplY3RzKHtcbiAgICAgIFByZWZpeDogJ3Rlc3QvJ1xuICAgIH0sIGZ1bmN0aW9uKGVycm9yLCBkYXRhKSB7XG4gICAgICB2YXIgaHRtbDtcbiAgICAgIGlmIChlcnJvcikge1xuICAgICAgICByZXR1cm4gY29uc29sZS5lcnJvcihlcnJvcik7XG4gICAgICB9XG4gICAgICBodG1sID0gW107XG4gICAgICBodG1sLnB1c2goJzx1bD4nKTtcbiAgICAgIGRhdGEuQ29udGVudHMuZm9yRWFjaChmdW5jdGlvbihyb3cpIHtcbiAgICAgICAgcmV0dXJuIGh0bWwucHVzaCgnPGxpPicgKyByb3cuS2V5ICsgJyAoJyArIChmaWxlc2l6ZShyb3cuU2l6ZSwge1xuICAgICAgICAgIHVuaXg6IHRydWVcbiAgICAgICAgfSkpICsgJyk8L2xpPicpO1xuICAgICAgfSk7XG4gICAgICBodG1sLnB1c2goJzwvdWw+Jyk7XG4gICAgICByZXR1cm4gZG9jdW1lbnQuZ2V0RWxlbWVudEJ5SWQoJ3VwbG9hZGVkLWZpbGVzJykuaW5uZXJIVE1MID0gaHRtbC5qb2luKCcnKTtcbiAgICB9KTtcbiAgICByZXR1cm4gUzMubGlzdE11bHRpcGFydFVwbG9hZHMoe1xuICAgICAgUHJlZml4OiAndGVzdC8nXG4gICAgfSwgZnVuY3Rpb24oZXJyb3IsIGRhdGEpIHtcbiAgICAgIHZhciBodG1sO1xuICAgICAgaWYgKGVycm9yKSB7XG4gICAgICAgIHJldHVybiBjb25zb2xlLmVycm9yKGVycm9yKTtcbiAgICAgIH1cbiAgICAgIGNvbnNvbGUubG9nKGRhdGEpO1xuICAgICAgaHRtbCA9IFtdO1xuICAgICAgaHRtbC5wdXNoKCc8dWw+Jyk7XG4gICAgICByZXR1cm4gUS5hbGwoZGF0YS5VcGxvYWRzLm1hcChmdW5jdGlvbihyb3cpIHtcbiAgICAgICAgcmV0dXJuIFEubmZjYWxsKGZ1bmN0aW9uKGNiKSB7XG4gICAgICAgICAgcmV0dXJuIFMzLmxpc3RQYXJ0cyh7XG4gICAgICAgICAgICBLZXk6IHJvdy5LZXksXG4gICAgICAgICAgICBVcGxvYWRJZDogcm93LlVwbG9hZElkXG4gICAgICAgICAgfSwgZnVuY3Rpb24oZXJyb3IsIGRhdGEpIHtcbiAgICAgICAgICAgIHZhciBpLCBsZW4sIHBhcnQsIHJlZiwgdXBsb2FkZWRTaXplO1xuICAgICAgICAgICAgaWYgKGVycm9yKSB7XG4gICAgICAgICAgICAgIHJldHVybiBjYihlcnJvcik7XG4gICAgICAgICAgICB9XG4gICAgICAgICAgICBjb25zb2xlLmxvZyhyb3cuS2V5LCBkYXRhKTtcbiAgICAgICAgICAgIHVwbG9hZGVkU2l6ZSA9IDA7XG4gICAgICAgICAgICByZWYgPSBkYXRhLlBhcnRzO1xuICAgICAgICAgICAgZm9yIChpID0gMCwgbGVuID0gcmVmLmxlbmd0aDsgaSA8IGxlbjsgaSsrKSB7XG4gICAgICAgICAgICAgIHBhcnQgPSByZWZbaV07XG4gICAgICAgICAgICAgIHVwbG9hZGVkU2l6ZSArPSBwYXJ0LlNpemU7XG4gICAgICAgICAgICB9XG4gICAgICAgICAgICByZXR1cm4gY2IobnVsbCwgdXBsb2FkZWRTaXplKTtcbiAgICAgICAgICB9KTtcbiAgICAgICAgfSkudGhlbihmdW5jdGlvbihzaXplKSB7XG4gICAgICAgICAgcmV0dXJuIGh0bWwucHVzaCgnPGxpPicgKyByb3cuS2V5ICsgJygnICsgKGZpbGVzaXplKHNpemUsIHtcbiAgICAgICAgICAgIHVuaXg6IHRydWVcbiAgICAgICAgICB9KSkgKyAnIHVwbG9hZGVkKTwvbGk+Jyk7XG4gICAgICAgIH0pO1xuICAgICAgfSkpLnRoZW4oZnVuY3Rpb24oKSB7XG4gICAgICAgIGh0bWwucHVzaCgnPC91bD4nKTtcbiAgICAgICAgcmV0dXJuIGRvY3VtZW50LmdldEVsZW1lbnRCeUlkKCd1cGxvYWRpbmctZmlsZXMnKS5pbm5lckhUTUwgPSBodG1sLmpvaW4oJycpO1xuICAgICAgfSk7XG4gICAgfSk7XG4gIH07XG5cbn0pLmNhbGwodGhpcyk7XG4iLCIoZnVuY3Rpb24oKSB7XG4gIHZhciAkY29uZmlnLCBUQUcsIGJ1Y2tldDtcblxuICBBV1MuY29uZmlnLnVwZGF0ZSh7XG4gICAgYWNjZXNzS2V5SWQ6ICdBS0lBSlFKVVI3T01RS1BIRVBaQScsXG4gICAgc2VjcmV0QWNjZXNzS2V5OiAnKytJVzZlZ29ZaHlsVk8vRXExbk5rRHZPUkpWcmI3U1pmN1NUZXdMUydcbiAgfSk7XG5cbiAgYnVja2V0ID0gbmV3IEFXUy5TMyh7XG4gICAgcGFyYW1zOiB7XG4gICAgICBCdWNrZXQ6ICd0cmFuc2Zlci50ZXNlcmEuY29tJ1xuICAgIH0sXG4gICAgaHR0cE9wdGlvbnM6IHtcbiAgICAgIHRpbWVvdXQ6IDBcbiAgICB9XG4gIH0pO1xuXG4gIFRBRyA9ICdbdGVzdGluZ10gLSc7XG5cbiAgJGNvbmZpZyA9IHtcbiAgICBtcHVNaW5TaXplOiA1MCAqIDEwMjQgKiAxMDI0LFxuICAgIG1wdVBhcnRTaXplOiBmdW5jdGlvbihzaXplKSB7XG4gICAgICB2YXIgRywgTTtcbiAgICAgIE0gPSBNYXRoLnBvdygxMDI0LCAyKTtcbiAgICAgIEcgPSBNYXRoLnBvdygxMDI0LCAzKTtcbiAgICAgIHN3aXRjaCAoZmFsc2UpIHtcbiAgICAgICAgY2FzZSAhKHNpemUgPj0gNTAgKiBHKTpcbiAgICAgICAgICByZXR1cm4gMC41ICogRztcbiAgICAgICAgY2FzZSAhKHNpemUgPj0gNSAqIEcpOlxuICAgICAgICAgIHJldHVybiAwLjEgKiBHO1xuICAgICAgICBjYXNlICEoc2l6ZSA+PSA1MDAgKiBNKTpcbiAgICAgICAgICByZXR1cm4gMjAgKiBNO1xuICAgICAgICBkZWZhdWx0OlxuICAgICAgICAgIHJldHVybiA1ICogTTtcbiAgICAgIH1cbiAgICB9LFxuICAgIG1heFVwbG9hZGluZ0ZpbGVzTnVtYmVyOiAzLFxuICAgIG1heFVwbG9hZGluZ1BhcnRzTnVtYmVyOiA1XG4gIH07XG5cbiAgYnVja2V0LnVwbG9hZCA9IGZ1bmN0aW9uKGZpbGUsIG1vcmUpIHtcbiAgICBpZiAoIWZpbGUuVXBsb2FkSWQgJiYgZmlsZS5zaXplIDwgJGNvbmZpZy5tcHVNaW5TaXplKSB7XG4gICAgICByZXR1cm4gdGhpcy51cGxvYWRTbWFsbC5hcHBseSh0aGlzLCBhcmd1bWVudHMpO1xuICAgIH0gZWxzZSB7XG4gICAgICByZXR1cm4gdGhpcy51cGxvYWRNdWx0aXBhcnRMYXJnZS5hcHBseSh0aGlzLCBhcmd1bWVudHMpO1xuICAgIH1cbiAgfTtcblxuICBidWNrZXQudXBsb2FkU21hbGwgPSBmdW5jdGlvbihmaWxlLCBrZXksIGNhbGxiYWNrLCBub3RpZnkpIHtcbiAgICB2YXIgcGFyYW1zLCByZXE7XG4gICAgY29uc29sZS5sb2coVEFHLCBbJ3VwbG9hZFNtYWxsJywga2V5XSk7XG4gICAgcGFyYW1zID0ge1xuICAgICAgS2V5OiBrZXksXG4gICAgICBDb250ZW50VHlwZTogZmlsZS50eXBlLFxuICAgICAgQm9keTogZmlsZVxuICAgIH07XG4gICAgcmV0dXJuIHJlcSA9IGJ1Y2tldC5wdXRPYmplY3QocGFyYW1zLCBjYWxsYmFjaykub24oJ2h0dHBVcGxvYWRQcm9ncmVzcycsIGZ1bmN0aW9uKGV2ZW50KSB7XG4gICAgICByZXR1cm4gbm90aWZ5KHtcbiAgICAgICAgbG9hZGVkOiBldmVudC5sb2FkZWQsXG4gICAgICAgIHJlcTogcmVxXG4gICAgICB9KTtcbiAgICB9KS5vbigncmV0cnknLCBmdW5jdGlvbihyZXMpIHtcbiAgICAgIGlmIChyZXMuZXJyb3IpIHtcbiAgICAgICAgcmV0dXJuIHJlcy5lcnJvci5yZXRyeWFibGUgPSBmYWxzZTtcbiAgICAgIH1cbiAgICB9KTtcbiAgfTtcblxuICBidWNrZXQudXBsb2FkTXVsdGlwYXJ0TGFyZ2UgPSBmdW5jdGlvbihmaWxlLCBrZXksIGNhbGxiYWNrLCBub3RpZnkpIHtcbiAgICB2YXIgX3VwbG9hZExhcmdlLCBtcHVQYXJ0U2l6ZTtcbiAgICBjb25zb2xlLmxvZyhUQUcsIFsndXBsb2FkTXVsdGlwYXJ0TGFyZ2UnLCBrZXldKTtcbiAgICBtcHVQYXJ0U2l6ZSA9ICRjb25maWcubXB1UGFydFNpemUoZmlsZS5zaXplKTtcbiAgICBfdXBsb2FkTGFyZ2UgPSBmdW5jdGlvbihVcGxvYWRJZCwgUGFydE51bWJlcnMsIGNhbGxiYWNrKSB7XG4gICAgICB2YXIgY29tcGxldGUsIGZhaWx1cmVRdWV1ZSwgZ2V0UGFydCwgaywgcGFydCwgcGFydEluZGV4LCBxdWV1ZSwgcXVldWVQYXJ0cywgdG90YWxVcGxvYWRlZFNpemUsIHVwbG9hZFBhcnQ7XG4gICAgICBxdWV1ZSA9IFtdO1xuICAgICAgZmFpbHVyZVF1ZXVlID0gW107XG4gICAgICBwYXJ0SW5kZXggPSAwO1xuICAgICAgdG90YWxVcGxvYWRlZFNpemUgPSAwO1xuICAgICAgZm9yIChrIGluIFBhcnROdW1iZXJzKSB7XG4gICAgICAgIHBhcnQgPSBQYXJ0TnVtYmVyc1trXTtcbiAgICAgICAgdG90YWxVcGxvYWRlZFNpemUgKz0gcGFydC5TaXplO1xuICAgICAgfVxuICAgICAgcXVldWVQYXJ0cyA9IGZ1bmN0aW9uKCkge1xuICAgICAgICB3aGlsZSAocXVldWUubGVuZ3RoIDwgJGNvbmZpZy5tYXhVcGxvYWRpbmdQYXJ0c051bWJlcikge1xuICAgICAgICAgIGlmIChwYXJ0ID0gZmFpbHVyZVF1ZXVlLnNoaWZ0KCkpIHtcbiAgICAgICAgICAgIHVwbG9hZFBhcnQocGFydCk7XG4gICAgICAgICAgICBjb250aW51ZTtcbiAgICAgICAgICB9XG4gICAgICAgICAgaWYgKHBhcnQgPSBnZXRQYXJ0KHBhcnRJbmRleCsrKSkge1xuICAgICAgICAgICAgaWYgKFBhcnROdW1iZXJzW3BhcnQuUGFydE51bWJlcl0pIHtcbiAgICAgICAgICAgICAgY29udGludWU7XG4gICAgICAgICAgICB9XG4gICAgICAgICAgICB1cGxvYWRQYXJ0KHBhcnQpO1xuICAgICAgICAgIH0gZWxzZSB7XG4gICAgICAgICAgICBicmVhaztcbiAgICAgICAgICB9XG4gICAgICAgIH1cbiAgICAgICAgY29uc29sZS5sb2coVEFHLCAncGFydHMgcXVldWU6JywgcXVldWUubWFwKGZ1bmN0aW9uKHBhcnQpIHtcbiAgICAgICAgICByZXR1cm4gcGFydC5QYXJ0TnVtYmVyO1xuICAgICAgICB9KSk7XG4gICAgICAgIGlmICghcGFydCAmJiAwID09PSBxdWV1ZS5sZW5ndGgpIHtcbiAgICAgICAgICByZXR1cm4gY29tcGxldGUoKTtcbiAgICAgICAgfVxuICAgICAgfTtcbiAgICAgIGdldFBhcnQgPSBmdW5jdGlvbihpbmRleCkge1xuICAgICAgICB2YXIgZW5kLCBzdGFydDtcbiAgICAgICAgc3RhcnQgPSBpbmRleCAqIG1wdVBhcnRTaXplO1xuICAgICAgICBpZiAoc3RhcnQgPj0gZmlsZS5zaXplKSB7XG4gICAgICAgICAgcmV0dXJuIHBhcnQgPSBmYWxzZTtcbiAgICAgICAgfSBlbHNlIHtcbiAgICAgICAgICBlbmQgPSBNYXRoLm1pbihzdGFydCArIG1wdVBhcnRTaXplLCBmaWxlLnNpemUpO1xuICAgICAgICAgIHJldHVybiBwYXJ0ID0ge1xuICAgICAgICAgICAgUGFydE51bWJlcjogaW5kZXggKyAxLFxuICAgICAgICAgICAgc3RhcnQ6IHN0YXJ0LFxuICAgICAgICAgICAgc2l6ZTogZW5kIC0gc3RhcnQsXG4gICAgICAgICAgICBlbmQ6IGVuZCxcbiAgICAgICAgICAgIHBlcmNlbnQ6IDAsXG4gICAgICAgICAgICBsb2FkZWQ6IDBcbiAgICAgICAgICB9O1xuICAgICAgICB9XG4gICAgICB9O1xuICAgICAgdXBsb2FkUGFydCA9IGZ1bmN0aW9uKHBhcnQpIHtcbiAgICAgICAgcXVldWUucHVzaChwYXJ0KTtcbiAgICAgICAgcmV0dXJuIHBhcnQucmVxID0gYnVja2V0LnVwbG9hZFBhcnQoe1xuICAgICAgICAgIEtleToga2V5LFxuICAgICAgICAgIEJvZHk6IGZpbGUuc2xpY2UocGFydC5zdGFydCwgcGFydC5lbmQpLFxuICAgICAgICAgIENvbnRlbnRMZW5ndGg6IHBhcnQuc2l6ZSxcbiAgICAgICAgICBQYXJ0TnVtYmVyOiBwYXJ0LlBhcnROdW1iZXIsXG4gICAgICAgICAgVXBsb2FkSWQ6IFVwbG9hZElkXG4gICAgICAgIH0sIGZ1bmN0aW9uKGVycm9yLCBkYXRhKSB7XG4gICAgICAgICAgdmFyIGluZGV4O1xuICAgICAgICAgIGlmICgtMSAhPT0gKGluZGV4ID0gcXVldWUuaW5kZXhPZihwYXJ0KSkpIHtcbiAgICAgICAgICAgIHF1ZXVlLnNwbGljZShpbmRleCwgMSk7XG4gICAgICAgICAgfVxuICAgICAgICAgIHBhcnQucmVxID0gbnVsbDtcbiAgICAgICAgICBpZiAoZXJyb3IpIHtcbiAgICAgICAgICAgIGNvbnNvbGUuZXJyb3IoXCJGaWxlIFwiICsgZmlsZS5uYW1lICsgXCIocGFydCBcIiArIHBhcnQuUGFydE51bWJlciArIFwiKSB1cGxvYWQgZmFpbHVyZTogXCIgKyBlcnJvci5tZXNzYWdlICsgXCIgYXQgXCIgKyBlcnJvci5ob3N0bmFtZSk7XG4gICAgICAgICAgICBwYXJ0LmVycm9yID0gZXJyb3I7XG4gICAgICAgICAgICBmYWlsdXJlUXVldWUucHVzaChwYXJ0KTtcbiAgICAgICAgICAgIG5vdGlmeSh7XG4gICAgICAgICAgICAgIGxvYWRlZDogdG90YWxVcGxvYWRlZFNpemVcbiAgICAgICAgICAgIH0pO1xuICAgICAgICAgICAgaWYgKDAgPT09IHF1ZXVlLmxlbmd0aCkge1xuICAgICAgICAgICAgICByZXR1cm4gY29tcGxldGUoKTtcbiAgICAgICAgICAgIH1cbiAgICAgICAgICB9IGVsc2Uge1xuICAgICAgICAgICAgY29uc29sZS5sb2coVEFHLCBbJ3VwbG9hZFBhcnQgc3VjY2VzcycsIGZpbGUubmFtZSwgJ3BhcnQnLCBwYXJ0LlBhcnROdW1iZXJdKTtcbiAgICAgICAgICAgIHRvdGFsVXBsb2FkZWRTaXplICs9IHBhcnQuc2l6ZTtcbiAgICAgICAgICAgIHBhcnQgPSBudWxsO1xuICAgICAgICAgICAgcmV0dXJuIHF1ZXVlUGFydHMoKTtcbiAgICAgICAgICB9XG4gICAgICAgIH0pLm9uKCdodHRwVXBsb2FkUHJvZ3Jlc3MnLCBmdW5jdGlvbihldmVudCkge1xuICAgICAgICAgIHZhciBhbGxQYXJ0c0xvYWRlZDtcbiAgICAgICAgICBwYXJ0LmxvYWRlZCA9IGV2ZW50LmxvYWRlZDtcbiAgICAgICAgICBwYXJ0LnBlcmNlbnQgPSBNYXRoLmZsb29yKHBhcnQubG9hZGVkICogMTAwIC8gcGFydC5zaXplKSArICclJztcbiAgICAgICAgICBhbGxQYXJ0c0xvYWRlZCA9IDA7XG4gICAgICAgICAgcXVldWUuZm9yRWFjaChmdW5jdGlvbihwYXJ0KSB7XG4gICAgICAgICAgICByZXR1cm4gYWxsUGFydHNMb2FkZWQgKz0gcGFydC5sb2FkZWQ7XG4gICAgICAgICAgfSk7XG4gICAgICAgICAgcmV0dXJuIG5vdGlmeSh7XG4gICAgICAgICAgICBsb2FkZWQ6IHRvdGFsVXBsb2FkZWRTaXplICsgYWxsUGFydHNMb2FkZWQsXG4gICAgICAgICAgICBwYXJ0czogcXVldWVcbiAgICAgICAgICB9KTtcbiAgICAgICAgfSk7XG4gICAgICB9O1xuICAgICAgY29tcGxldGUgPSBmdW5jdGlvbigpIHtcbiAgICAgICAgY29uc29sZS5sb2coVEFHLCBbJ3VwbG9hZExhcmdlJywgJ2NvbXBsZXRlJywgZmFpbHVyZVF1ZXVlXSk7XG4gICAgICAgIGlmIChmYWlsdXJlUXVldWUubGVuZ3RoKSB7XG4gICAgICAgICAgcmV0dXJuIGNhbGxiYWNrKHtcbiAgICAgICAgICAgIG1lc3NhZ2U6ICdTb21lIHBhcnRzIHVwbG9hZCBmYWlsdXJlIGR1ZSB0bzogJyArIGZhaWx1cmVRdWV1ZVswXS5lcnJvci5tZXNzYWdlXG4gICAgICAgICAgfSk7XG4gICAgICAgIH1cbiAgICAgICAgbm90aWZ5KHtcbiAgICAgICAgICBsb2FkZWQ6IHRydWVcbiAgICAgICAgfSk7XG4gICAgICAgIHJldHVybiBidWNrZXQubGlzdFBhcnRzKHtcbiAgICAgICAgICBLZXk6IGtleSxcbiAgICAgICAgICBVcGxvYWRJZDogVXBsb2FkSWRcbiAgICAgICAgfSwgZnVuY3Rpb24oZXJyb3IsIGRhdGEpIHtcbiAgICAgICAgICBpZiAoZXJyb3IpIHtcbiAgICAgICAgICAgIHJldHVybiBjb25zb2xlLmxvZyhlcnJvcik7XG4gICAgICAgICAgfVxuICAgICAgICAgIHJldHVybiBidWNrZXQuY29tcGxldGVNdWx0aXBhcnRVcGxvYWQoe1xuICAgICAgICAgICAgS2V5OiBrZXksXG4gICAgICAgICAgICBVcGxvYWRJZDogVXBsb2FkSWQsXG4gICAgICAgICAgICBNdWx0aXBhcnRVcGxvYWQ6IHtcbiAgICAgICAgICAgICAgUGFydHM6IGRhdGEuUGFydHMubWFwKGZ1bmN0aW9uKHBhcnQpIHtcbiAgICAgICAgICAgICAgICByZXR1cm4ge1xuICAgICAgICAgICAgICAgICAgRVRhZzogcGFydC5FVGFnLFxuICAgICAgICAgICAgICAgICAgUGFydE51bWJlcjogcGFydC5QYXJ0TnVtYmVyXG4gICAgICAgICAgICAgICAgfTtcbiAgICAgICAgICAgICAgfSlcbiAgICAgICAgICAgIH1cbiAgICAgICAgICB9LCBmdW5jdGlvbihlcnJvcikge1xuICAgICAgICAgICAgY29uc29sZS5sb2coVEFHLCBbJ3VwbG9hZExhcmdlJywgJ2NvbXBsZXRlTXVsdGlwYXJ0VXBsb2FkJywgJ2Vycm9yOicsIGVycm9yXSk7XG4gICAgICAgICAgICByZXR1cm4gY2FsbGJhY2soZXJyb3IpO1xuICAgICAgICAgIH0pO1xuICAgICAgICB9KTtcbiAgICAgIH07XG4gICAgICByZXR1cm4gcXVldWVQYXJ0cygpO1xuICAgIH07XG4gICAgcmV0dXJuIGJ1Y2tldC5saXN0TXVsdGlwYXJ0VXBsb2Fkcyh7XG4gICAgICBQcmVmaXg6IGtleVxuICAgIH0sIGZ1bmN0aW9uKGVycm9yLCBkYXRhKSB7XG4gICAgICB2YXIgVXBsb2FkSWQsIFVwbG9hZHM7XG4gICAgICBpZiAoZXJyb3IpIHtcbiAgICAgICAgcmV0dXJuIGNhbGxiYWNrKGVycm9yKTtcbiAgICAgIH1cbiAgICAgIFVwbG9hZHMgPSBkYXRhLlVwbG9hZHM7XG4gICAgICBpZiAoVXBsb2Fkcy5sZW5ndGgpIHtcbiAgICAgICAgVXBsb2FkSWQgPSBVcGxvYWRzLnBvcCgpLlVwbG9hZElkO1xuICAgICAgICBjb25zb2xlLmxvZyhUQUcsIFsndXBsb2FkTGFyZ2UnLCAnbGlzdFBhcnRzLi4uJ10pO1xuICAgICAgICByZXR1cm4gYnVja2V0Lmxpc3RQYXJ0cyh7XG4gICAgICAgICAgS2V5OiBrZXksXG4gICAgICAgICAgVXBsb2FkSWQ6IFVwbG9hZElkXG4gICAgICAgIH0sIGZ1bmN0aW9uKGVycm9yLCBkYXRhKSB7XG4gICAgICAgICAgdmFyIFBhcnROdW1iZXJzLCBpLCBsZW4sIHBhcnQsIHJlZjtcbiAgICAgICAgICBjb25zb2xlLmxvZyhUQUcsIFsndXBsb2FkTGFyZ2UnLCAnbGlzdFBhcnRzLi4uJywgZGF0YSAmJiBkYXRhLlBhcnRzIHx8IGVycm9yXSk7XG4gICAgICAgICAgaWYgKGVycm9yKSB7XG4gICAgICAgICAgICByZXR1cm4gY2FsbGJhY2soZXJyb3IpO1xuICAgICAgICAgIH1cbiAgICAgICAgICBQYXJ0TnVtYmVycyA9IHt9O1xuICAgICAgICAgIHJlZiA9IGRhdGEuUGFydHM7XG4gICAgICAgICAgZm9yIChpID0gMCwgbGVuID0gcmVmLmxlbmd0aDsgaSA8IGxlbjsgaSsrKSB7XG4gICAgICAgICAgICBwYXJ0ID0gcmVmW2ldO1xuICAgICAgICAgICAgUGFydE51bWJlcnNbcGFydC5QYXJ0TnVtYmVyXSA9IHBhcnQ7XG4gICAgICAgICAgfVxuICAgICAgICAgIHJldHVybiBfdXBsb2FkTGFyZ2UoVXBsb2FkSWQsIFBhcnROdW1iZXJzLCBmdW5jdGlvbihlcnJvcikge1xuICAgICAgICAgICAgdmFyIGosIGxlbjEsIHJvdztcbiAgICAgICAgICAgIGZvciAoaiA9IDAsIGxlbjEgPSBVcGxvYWRzLmxlbmd0aDsgaiA8IGxlbjE7IGorKykge1xuICAgICAgICAgICAgICByb3cgPSBVcGxvYWRzW2pdO1xuICAgICAgICAgICAgICBidWNrZXQuYWJvcnRNdWx0aXBhcnRVcGxvYWQoe1xuICAgICAgICAgICAgICAgIEtleToga2V5LFxuICAgICAgICAgICAgICAgIFVwbG9hZElkOiByb3cuVXBsb2FkSWRcbiAgICAgICAgICAgICAgfSwgZnVuY3Rpb24oZXJyb3IpIHtcbiAgICAgICAgICAgICAgICByZXR1cm4gY29uc29sZS5sb2coVEFHLCBbXG4gICAgICAgICAgICAgICAgICAnY2xlYW4gYWJvcnRNdWx0aXBhcnRVcGxvYWQnLCB7XG4gICAgICAgICAgICAgICAgICAgIGVycm9yOiBlcnJvclxuICAgICAgICAgICAgICAgICAgfVxuICAgICAgICAgICAgICAgIF0pO1xuICAgICAgICAgICAgICB9KTtcbiAgICAgICAgICAgIH1cbiAgICAgICAgICAgIHJldHVybiBjYWxsYmFjayhlcnJvcik7XG4gICAgICAgICAgfSk7XG4gICAgICAgIH0pO1xuICAgICAgfSBlbHNlIHtcbiAgICAgICAgY29uc29sZS5sb2coVEFHLCBbJ3VwbG9hZExhcmdlJywgJ2NyZWF0ZU11bHRpcGFydFVwbG9hZC4uLiddKTtcbiAgICAgICAgcmV0dXJuIGJ1Y2tldC5jcmVhdGVNdWx0aXBhcnRVcGxvYWQoe1xuICAgICAgICAgIEtleToga2V5XG4gICAgICAgIH0sIGZ1bmN0aW9uKGVycm9yLCBkYXRhKSB7XG4gICAgICAgICAgY29uc29sZS5sb2coVEFHLCBbJ3VwbG9hZExhcmdlJywgJ2NyZWF0ZU11bHRpcGFydFVwbG9hZCcsICdlcnJvcjonLCBlcnJvcl0pO1xuICAgICAgICAgIGlmIChlcnJvcikge1xuICAgICAgICAgICAgcmV0dXJuIGNhbGxiYWNrKGVycm9yKTtcbiAgICAgICAgICB9XG4gICAgICAgICAgcmV0dXJuIF91cGxvYWRMYXJnZShkYXRhLlVwbG9hZElkLCB7fSwgY2FsbGJhY2spO1xuICAgICAgICB9KTtcbiAgICAgIH1cbiAgICB9KTtcbiAgfTtcblxuICB3aW5kb3cuUzMgPSBidWNrZXQ7XG5cbn0pLmNhbGwodGhpcyk7XG4iXSwic291cmNlUm9vdCI6Ii9zb3VyY2UvIn0=