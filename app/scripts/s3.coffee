## http://docs.aws.amazon.com/AWSJavaScriptSDK/guide/browser-configuring.html
AWS.config.update accessKeyId: 'AKIAJQJUR7OMQKPHEPZA', secretAccessKey: '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'
# AWS.config.region = 'us-west-1'
bucket = new AWS.S3
	params:
		Bucket: 'transfer.tesera.com'
	httpOptions:
		timeout: 0


TAG = '[testing] -'
$config =
	mpuMinSize: 50 * 1024 * 1024 # files(> this value) will be uploaded using multi-part way
	# should be >= 5M, 5M is 5 * 1024 * 1024, !important
	mpuPartSize: (size) ->
		M = Math.pow 1024, 2
		G = Math.pow 1024, 3
		switch
			# 5T	= 5 000 000 M -> 500M * 10 000
			# 500 G	=   500 000 M -> 500M * 1000
			# 50 G	=    50 000 M -> 500M * 100
			when size >= 50 * G then 0.5 * G
			# 49 G	=    49 000 M -> 100M * 490
			# 5 G	=     5 000 M -> 100M * 50
			when size >= 5 * G then 0.1 * G
			# 4.9 G	=     4 900 M -> 20M * 245
			# 500 M	=       500 M -> 20M * 25
			when size >= 500 * M then 20 * M
			# 490 M	=       490 M -> 5M * 98
			# 50 M	=        50 M -> 5M * 10
			else 5 * M
	maxUploadingFilesNumber: 3 # max files uploading at the same time
	maxUploadingPartsNumber: 5


bucket.upload = (file, more) ->
	if !file.UploadId && file.size < $config.mpuMinSize
		@uploadSmall.apply @, arguments
	else
		@uploadMultipartLarge.apply @, arguments

bucket.uploadSmall = (file, key, callback, notify) ->
	console.log TAG, ['uploadSmall', key]
	params =
		Key: key
		ContentType: file.type
		Body: file
	req = bucket.putObject params, callback
	.on 'httpUploadProgress', (event) ->
		notify loaded: event.loaded, req: req
	.on 'retry', (res) ->
		res.error.retryable = false if res.error

bucket.uploadMultipartLarge = (file, key, callback, notify) ->
	console.log TAG, ['uploadMultipartLarge', key]
	mpuPartSize = $config.mpuPartSize file.size
	_uploadLarge = (UploadId, PartNumbers, callback) ->
		queue = []
		failureQueue = []
		partIndex = 0
		totalUploadedSize = 0
		totalUploadedSize += part.Size for k, part of PartNumbers

		queueParts = ->
			while queue.length < $config.maxUploadingPartsNumber
				if part = failureQueue.shift()
					uploadPart part
					continue
				if part = getPart partIndex++
					continue if PartNumbers[part.PartNumber]
					uploadPart part
				else
					break
			console.log TAG, 'parts queue:', queue.map (part) -> part.PartNumber
			complete() if !part && 0 == queue.length
		getPart = (index) ->
			start = index * mpuPartSize
			if start >= file.size
				part = false
			else
				end = Math.min start + mpuPartSize, file.size
				part =
					PartNumber: index + 1 # index is from 0, but PartNumber is from 1
					start: start
					size: end - start
					end: end
					percent: 0
					loaded: 0
		uploadPart = (part) ->
			queue.push part
			part.req = bucket.uploadPart
				Key: key
				Body: file.slice part.start, part.end
				ContentLength: part.size
				PartNumber: part.PartNumber
				UploadId: UploadId
			, (error, data) ->
				queue.splice index, 1 if -1 != index = queue.indexOf part
				part.req = null
				if error
					console.error "File #{file.name}(part #{part.PartNumber}) upload failure: #{error.message} at #{error.hostname}"
					##console.log TAG, ['uploadPart failure, try again 30s later', file.name, 'part', part.PartNumber]
					##uploadPart part
					part.error = error
					failureQueue.push part
					notify loaded: totalUploadedSize # ignore failed progress data size
					complete() if 0 == queue.length
				else
					console.log TAG, ['uploadPart success', file.name, 'part', part.PartNumber]
					totalUploadedSize += part.size
					part = null
					queueParts()
			.on 'httpUploadProgress', (event) ->
				part.loaded = event.loaded
				part.percent = Math.floor(part.loaded * 100 / part.size) + '%'
				allPartsLoaded = 0
				queue.forEach (part) -> allPartsLoaded += part.loaded
				notify loaded: totalUploadedSize + allPartsLoaded, parts: queue
			# .on 'retry', (res) ->
			# 	res.error.retryable = false if res.error
		complete = ->
			console.log TAG, ['uploadLarge', 'complete', failureQueue]
			return callback message: 'Some parts upload failure due to: ' + failureQueue[0].error.message if failureQueue.length
			notify loaded: true
			bucket.listParts Key: key, UploadId: UploadId, (error, data) ->
				return console.log error if error
				bucket.completeMultipartUpload
					Key: key
					UploadId: UploadId
					MultipartUpload: Parts: data.Parts.map (part) -> ETag: part.ETag, PartNumber: part.PartNumber
				, (error) ->
					console.log TAG, ['uploadLarge', 'completeMultipartUpload', 'error:', error]
					callback error
		queueParts()

	bucket.listMultipartUploads Prefix: key, (error, data) ->
		return callback error if error
		Uploads = data.Uploads
		if Uploads.length
			UploadId = Uploads.pop().UploadId
			console.log TAG, ['uploadLarge', 'listParts...']
			bucket.listParts Key: key, UploadId: UploadId, (error, data) ->
				console.log TAG, ['uploadLarge', 'listParts...', data && data.Parts || error]
				return callback error if error
				PartNumbers = {}
				PartNumbers[part.PartNumber] = part for part in data.Parts
				_uploadLarge UploadId, PartNumbers, (error) ->
					for row in Uploads
						bucket.abortMultipartUpload Key: key, UploadId: row.UploadId, (error) ->
							console.log TAG, ['clean abortMultipartUpload', error: error]
					callback error
		else
			console.log TAG, ['uploadLarge', 'createMultipartUpload...']
			bucket.createMultipartUpload Key: key, (error, data) ->
				console.log TAG, ['uploadLarge', 'createMultipartUpload', 'error:', error]
				return callback error if error
				_uploadLarge data.UploadId, {}, callback

window.S3 = bucket
