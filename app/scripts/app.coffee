window.upload = (file) ->
	S3.upload file, 'test/' + file.name, (error, data) ->
		return console.error error if error
		console.log data
	, (info) ->
		if info.loaded == true
		else if 'number' == typeof info.loaded
			loadedSize = filesize info.loaded, unix: true
			totalSize = filesize file.size, unix: true
			percent = Math.floor(info.loaded * 10000 / file.size) / 100 + '%'
			progress = '[' + loadedSize + '/' + totalSize + '] ' + percent
		parts = if info.parts then info.parts.map((part) -> part.percent).join ' ' else '-'
		console.log [progress, parts]
		document.getElementById('log').innerHTML = [progress, parts].join ' '

document.body.onload = ->
	S3.listObjects Prefix: 'test/', (error, data) ->
		return console.error error if error
		html = []
		html.push '<ul>'
		data.Contents.forEach (row) -> html.push '<li>' + row.Key + ' (' + (filesize row.Size, unix: true) + ')</li>'
		html.push '</ul>'
		document.getElementById('uploaded-files').innerHTML = html.join ''

	S3.listMultipartUploads Prefix: 'test/', (error, data) ->
		return console.error error if error
		console.log data
		html = []
		html.push '<ul>'
		Q.all data.Uploads.map (row) ->
			Q.nfcall (cb) ->
				S3.listParts Key: row.Key, UploadId: row.UploadId, (error, data) ->
					return cb error if error
					console.log row.Key, data
					uploadedSize = 0
					uploadedSize += part.Size for part in data.Parts
					cb null, uploadedSize
			.then (size) ->
				html.push '<li>' + row.Key + '(' + (filesize size, unix: true) + ' uploaded)</li>'
		.then ->
			html.push '</ul>'
			document.getElementById('uploading-files').innerHTML = html.join ''
