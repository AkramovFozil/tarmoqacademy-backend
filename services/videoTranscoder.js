const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');

const renditions = [
  { height: 360, bandwidth: 800000, videoBitrate: '800k', audioBitrate: '96k' },
  { height: 720, bandwidth: 2800000, videoBitrate: '2800k', audioBitrate: '128k' },
  { height: 1080, bandwidth: 5000000, videoBitrate: '5000k', audioBitrate: '160k' },
];

const runProcess = (command, args) => new Promise((resolve, reject) => {
  const child = spawn(command, args, { stdio: ['ignore', 'pipe', 'pipe'] });
  let stderr = '';

  child.stderr.on('data', (chunk) => {
    stderr += chunk.toString();
  });

  child.on('error', reject);
  child.on('close', (code) => {
    if (code === 0) {
      resolve();
      return;
    }

    reject(new Error(`${command} xatolik bilan tugadi (${code}): ${stderr.slice(-2000)}`));
  });
});

const assertFfmpegAvailable = async () => {
  await runProcess('ffmpeg', ['-version']);
};

const transcodeRendition = async ({ inputPath, outputDir, rendition }) => {
  await fs.promises.mkdir(outputDir, { recursive: true });

  const playlistPath = path.join(outputDir, 'index.m3u8');
  const segmentPattern = path.join(outputDir, 'segment_%05d.ts');

  await runProcess('ffmpeg', [
    '-y',
    '-i', inputPath,
    '-vf', `scale=-2:${rendition.height}`,
    '-c:v', 'libx264',
    '-preset', process.env.FFMPEG_PRESET || 'veryfast',
    '-profile:v', 'main',
    '-crf', process.env.FFMPEG_CRF || '23',
    '-maxrate', rendition.videoBitrate,
    '-bufsize', String(parseInt(rendition.videoBitrate, 10) * 2) + 'k',
    '-c:a', 'aac',
    '-b:a', rendition.audioBitrate,
    '-ac', '2',
    '-hls_time', process.env.HLS_SEGMENT_SECONDS || '6',
    '-hls_playlist_type', 'vod',
    '-hls_segment_filename', segmentPattern,
    playlistPath,
  ]);
};

const writeMasterPlaylist = async ({ outputRoot, selectedRenditions }) => {
  const lines = ['#EXTM3U', '#EXT-X-VERSION:3'];

  selectedRenditions.forEach((rendition) => {
    lines.push(`#EXT-X-STREAM-INF:BANDWIDTH=${rendition.bandwidth},RESOLUTION=1920x${rendition.height}`);
    lines.push(`${rendition.height}/index.m3u8`);
  });

  await fs.promises.writeFile(path.join(outputRoot, 'master.m3u8'), `${lines.join('\n')}\n`, 'utf8');
};

const transcodeToHls = async ({ inputPath, outputRoot }) => {
  await assertFfmpegAvailable();
  await fs.promises.rm(outputRoot, { recursive: true, force: true });
  await fs.promises.mkdir(outputRoot, { recursive: true });

  for (const rendition of renditions) {
    await transcodeRendition({
      inputPath,
      outputDir: path.join(outputRoot, String(rendition.height)),
      rendition,
    });
  }

  await writeMasterPlaylist({ outputRoot, selectedRenditions: renditions });

  return {
    masterPath: path.join(outputRoot, 'master.m3u8'),
    renditions: renditions.map((item) => item.height),
    outputRoot,
  };
};

module.exports = {
  transcodeToHls,
  renditions,
};
