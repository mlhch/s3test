###
# Official examples:
# @url https://github.com/gulpjs/gulp/blob/master/docs/getting-started.md
###

gulp           = require 'gulp'
gulpFilter     = require 'gulp-filter'
concat         = require 'gulp-concat'
uglify         = require 'gulp-uglify'
sourcemaps     = require 'gulp-sourcemaps'
minifyCSS      = require 'gulp-minify-css'
coffee         = require 'gulp-coffee'
compass        = require 'gulp-compass'
gls            = require 'gulp-live-server'


input = (stream) ->
	stream = gulp.src stream
	pipe: (action) -> stream = stream.pipe action if action; @
	on: (event, callback) -> stream.on event, callback; @

src_app = ->
	[
		'app/scripts/**/*.coffee'
	]
src_vendor = ->
	[
		'bower_components/q/q.js'
		'bower_components/aws-sdk/dist/aws-sdk.js'
		'bower_components/filesize/lib/filesize.js'
	]

gulp.task 'default', ->
	# place code for your default task here
	gulp.start [
		'app:scripts'
		'vendor:scripts'
		'serve'
	]

gulp.task 'app:scripts', ->
	input src_app()
	.pipe coffee()
	.on 'error', console.error
	.pipe sourcemaps.init()
	.pipe concat 'app.js'
	.pipe sourcemaps.write()
	.pipe gulp.dest 'dist/scripts'

gulp.task 'vendor:scripts', ->
	input src_vendor()
	.pipe sourcemaps.init()
	.pipe concat 'vendor.js'
	.pipe sourcemaps.write()
	.pipe gulp.dest 'dist/scripts'

gulp.task 'serve', ->
	server = gls.static '.', 8000
	server.start()


###
# Official examples:
# @url https://github.com/gulpjs/gulp/blob/master/docs/API.md#gulpwatchglob--opts-tasks-or-gulpwatchglob--opts-cb
#
var watcher = gulp.watch('js/ * * / *.js', ['uglify','reload']);
watcher.on('change', function(event) {
  console.log('File ' + event.path + ' was ' + event.type + ', running tasks...');
});

gulp.watch('j s / * * / *.js', function(event) {
  console.log('File ' + event.path + ' was ' + event.type + ', running tasks...');
});
###
gulp.task 'watch', ['default'], ->
	gulp.watch src_app(), ['app:scripts']
	.on 'change', (event) ->
		console.log 'File ' + event.path + ' was ' + event.type + ', running tasks...'
