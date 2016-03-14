/// <reference path="wav-decoder.d.ts" />

declare var require, self;
import WavDecoder = require('wav-decoder');



// JavaScript port of https://github.com/gocha/DPCMConverter

export interface IWavFileFormat {
	sampleRate: number;
	numberOfChannels: number;
	sampleLength: number;
	startSilence: number;
	endSilence: number;
	preview: {
		max: Float32Array;
		min: Float32Array;
	}[];
}

export interface IDPCMOptions {
	stereoMix?: boolean;
	stereoLeft?: boolean;
	normalizeCheck?: boolean;
	inputVolumeCb?: number;
	dpcmSampleRateCb?: number;
	dmcAlignCheck?: boolean;
	startPosition?: number;
	endPosition?: number;
	previewSize?: number;
	loop?: boolean;
	id?: number;
}

export interface IDPCMResult {
	mml: string;
	preview?: Float32Array;
}

export const SAMPLERATE_DATAPROVIDER = [
	{ label: "4.18KHz", data: 0x00 },
	{ label: "4.71KHz", data: 0x01 },
	{ label: "5.26KHz", data: 0x02 },
	{ label: "5.59KHz", data: 0x03 },
	{ label: "6.26KHz", data: 0x04 },
	{ label: "7.05KHz", data: 0x05 },
	{ label: "7.92KHz", data: 0x06 },
	{ label: "8.36KHz", data: 0x07 },
	{ label: "9.42KHz", data: 0x08 },
	{ label: "11.18KHz", data: 0x09 },
	{ label: "12.60KHz", data: 0x0a },
	{ label: "13.98KHz", data: 0x0b },
	{ label: "16.88KHz", data: 0x0c },
	{ label: "21.30KHz", data: 0x0d },
	{ label: "24.86KHz", data: 0x0e },
	{ label: "33.14KHz", data: 0x0f }
];

const DMC_TABLE = [
	0xD60, 0xBE0, 0xAA0, 0xA00, 0x8F0, 0x7F0, 0x710, 0x6B0,
	0x5F0, 0x500, 0x470, 0x400, 0x350, 0x2A0, 0x240, 0x1B0,
];

const SILENCE_THRESHOLD = Math.pow(2.0, -6);

export function wav2dpcm(sampleRate: number, channelData: Float32Array[], opts?: IDPCMOptions): IDPCMResult {
	if (!opts) opts = {};

	var i: number;
	var j: number;
	
	if (opts.startPosition == null) opts.startPosition = 0;
	if (opts.endPosition == null) opts.endPosition = channelData[0].length;
	for (i = 0; i < channelData.length; i++) {
		channelData[i] = channelData[i].subarray(opts.startPosition, opts.endPosition);
	}
	
	// 前処理(チャンネル選択・ノーマライズ)
	var samplesNum: number = channelData[0].length;
	var maxLevel: number = 0.0;
	var monodata: Float32Array = new Float32Array(samplesNum);
	if (channelData.length == 1) {
		for (i = 0; i < samplesNum; i++) {
			var current = channelData[0][i];
			maxLevel = Math.max(maxLevel, Math.abs(current));
			monodata[i] = current;
		}
	} else {
		if (opts.stereoMix) {
			for (i = 0; i < samplesNum; i++) {
				var current = (channelData[0][i] + channelData[1][i]) / 2;
				maxLevel = Math.max(maxLevel, Math.abs(current));
				monodata[i] = current;
			}
		} else {
			var channel: number = opts.stereoLeft ? 0 : 1;
			for (i = 0; i < samplesNum; i++) {
				var current = channelData[channel][i];
				maxLevel = Math.max(maxLevel, Math.abs(current));
				monodata[i] = current;
			}
		}
	}

	// 入力音量の調整
	var scale: number = opts.inputVolumeCb == null ? 1.0 : opts.inputVolumeCb;
	if (opts.normalizeCheck && 0 < maxLevel) scale /= maxLevel;
	for (i = 0; i < monodata.length; i++) {
		monodata[i] *= scale;
	}

	// リサンプリング
	var dpcmSampleRate: number = sampleRate;
	var sampleStep: number = 1;
	if (opts.dpcmSampleRateCb != null && opts.dpcmSampleRateCb != -1) {
		dpcmSampleRate = ((1789772.5 * 8) / DMC_TABLE[opts.dpcmSampleRateCb]);
		// サンプルレートの差が1.0未満なら変換しない
		if (Math.abs(dpcmSampleRate - sampleRate) >= 1.0) {
			sampleStep = dpcmSampleRate / sampleRate;
		}
	}
	var sampleCount: number = sampleStep;
	var resampdata: Float32Array = new Float32Array(monodata.length * (sampleStep + 1) + 128);
	j = 0;
	i = 0;
	while (i < monodata.length) {
		while (sampleCount > 0.0) {
			resampdata[j++] = monodata[i];
			sampleCount -= 1.0;
		}
		while (sampleCount <= 0.0) {
			sampleCount += sampleStep;
			++i;
		}
	}
	// DPCM再生サイズ境界調整
	if (opts.dmcAlignCheck) {
		// 出力が 1+16n バイトになるよう入力サンプルを追加
		var lastSample: number = resampdata[j - 1];
		while ((resampdata.length - 8) % 128 != 0) {
			resampdata[j++] = lastSample;
		}
	}
	resampdata = resampdata.subarray(0, j);
	// ここからDMCconvベースの変換処理
	var dpcmData: Uint8Array = new Uint8Array(Math.ceil(resampdata.length / 8));
	var startdelta: number = Math.round((resampdata[0] + 1.0) / 2.0 * 127.0);
	var delta: number = startdelta;
	var dmcShift: number = 8;
	var dmcBits: number = 0;
	var dmcIncrease: Boolean = true;
	var dmcIncreaseLast: Boolean = true;
	var previewData: Float32Array = new Float32Array(opts.previewSize||512);
	var previewPos: number = 0;
	var previewStep: number = Math.ceil(resampdata.length / previewData.length);
	var previewCount: number = previewStep;
	j = 0;
	for (i = 0; i < resampdata.length; i++) {
		dmcBits >>= 1;
		
		previewData[previewPos] = Math.max(previewData[previewPos], Math.abs(resampdata[i]));
		if (--previewCount == 0) {
			previewCount = previewStep;
			previewPos++;
		}

		var deltaFloat: number = (delta - 0x40) / 0x40;
		dmcIncrease = (resampdata[i] > deltaFloat);
		// 等しい場合は次のサンプルに基づいて決定(気休め)
		if (resampdata[i] == deltaFloat && (i + 1) < resampdata.length) {
			dmcIncrease = (resampdata[i + 1] > deltaFloat);
			// 次まで等しい場合は直前の変化に揃える(超気休め)
			if (resampdata[i + 1] == deltaFloat) {
				dmcIncrease = dmcIncreaseLast
			}
		}

		if (dmcIncrease) {
			if (delta < 126) {
				delta += 2;
			}
			dmcBits |= 0x80;
		} else {
			if (delta > 1) {
				delta -= 2;
			}
		}
		dmcIncreaseLast = dmcIncrease

		if (--dmcShift == 0) {
			dpcmData[j++] = dmcBits;
			dmcShift = 8;
			dmcBits = 0;
		}
	}
				
	// 初期音量に戻るまで出力
	//if(backToInitVolCheck.selected){
	//	while(delta != startdelta){
	//		dmcBits >>= 1;
	//		if(delta < startdelta){
	//			delta += 2;
	//			dmcBits |= 0x80;
	//		}else{
	//			delta -= 2;
	//		}
	//		if(--dmcShift == 0){
	//			dpcmData[j++] = dmcBits;
	//			dmcShift = 8;
	//			dmcBits = 0;
	//		}
	//	}
	//}
				
	// 末尾の余りビットを出力
	if (dmcShift != 8) {
		// 最終音量を保つようにして出力
		var dmcMask: number = (1 << dmcShift) - 1;
		dmcBits >>= (dmcShift - 1);
		dmcBits |= 0x55 & ~dmcMask;
		dpcmData[j++] = dmcBits;
	}
	dpcmData = dpcmData.subarray(0, j);
				
	// サイズチェック
	if (dpcmData.length > 0x0ff1) {
		throw new Error('The generated data length is over the limit of DPCM.');
	}
	var dpcmStr = btoa(String.fromCharCode.apply(null, new Uint8Array(dpcmData)));

	// ここからFlMML用コード出力
	return {
		mml: `#WAV9 ${opts.id==null ? '$id' : opts.id},${startdelta},${opts.loop?1:0},${dpcmStr}`,
		preview: previewData
	};
}

export function wavFormat(audioData, previewSize: number): IWavFileFormat {
	var len = audioData.channelData[0].length;
	var result: IWavFileFormat = {
		sampleRate: audioData.sampleRate,
		numberOfChannels: audioData.channelData.length,
		sampleLength: len,
		startSilence: len,
		endSilence: len,
		preview: []
	};
	for (var ch = 0; ch < audioData.channelData.length; ch++) {
		var data = audioData.channelData[ch];
		var preview = {
			max: new Float32Array(previewSize),
			min: new Float32Array(previewSize)
		};
		result.preview.push(preview);
		var step = Math.ceil(data.length / preview.max.length);
		var s = 0;
		var j = 0;
		var i;
		for (i = 0; i < data.length; i++) {
			preview.max[j] = Math.max(preview.max[j], data[i]);
			preview.min[j] = Math.min(preview.min[j], data[i]);
			if (step <= ++s) {
				s = 0; j++;
			}
		}

		for (i = 0; i < data.length; i++) {
			if (SILENCE_THRESHOLD <= Math.abs(data[i])) break;
		}
		result.startSilence = Math.min(result.startSilence, i);

		for (i = 0; i < data.length; i++) {
			if (SILENCE_THRESHOLD <= Math.abs(data[data.length - 1 - i])) break;
		}
		result.endSilence = Math.min(result.endSilence, i);
	}
	return result;
}


self.onmessage = function(e) {

	switch (e.data.type) {

		case 'format':

			WavDecoder.decode(e.data.buffer)
				.then((audioData) => {
					self.postMessage({
						type: 'format',
						result: wavFormat(audioData, e.data.previewSize||512)
					});
				})
				.catch((ex) => {
					self.postMessage({
						type: 'error',
						error: ex.message
					});
				});

			break;

		case 'convert':

			WavDecoder.decode(e.data.buffer)
				.then((audioData) => {
					var result = wav2dpcm(
						audioData.sampleRate,
						audioData.channelData,
						e.data.options
					);
					self.postMessage({
						type: 'convert',
						result: result
					});
				})
				.catch((ex) => {
					self.postMessage({
						type: 'error',
						error: ex.message
					});
				});

			break;
		
	}
};
