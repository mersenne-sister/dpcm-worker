'use strict';

var gulp = require('gulp');
var typescript = require('gulp-typescript');
var browserify = require('gulp-browserify');
var sourcemaps = require('gulp-sourcemaps');

gulp.task('build', function(done){
	gulp.src([ 'src/dpcm-worker.ts' ])
		.pipe(sourcemaps.init())
		.pipe(typescript({
			target: 'es5',
			module: 'commonjs',
			removeComments: false
		}))
		.js
		.pipe(browserify({
			insertGlobals: true,
			debug: false
		}))
		.pipe(sourcemaps.write('./'))
		.pipe(gulp.dest('./dist/'))
		.on('end', done);
});

gulp.task('default', [ 'build' ]);
