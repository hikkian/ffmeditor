const DEFAULT_BAR_COUNT = 160;

function getAudioContext() {
  if (typeof window === 'undefined') return null;
  return window.AudioContext || window.webkitAudioContext || null;
}

// Files larger than this are skipped to prevent OOM on low-end devices.
// (The whole file is loaded into RAM twice: raw buffer + decoded PCM.)
const MAX_WAVEFORM_FILE_BYTES = 100 * 1024 * 1024; // 100 MB

export async function generateWaveformPeaks(fileUrl, barCount = DEFAULT_BAR_COUNT, fileSizeBytes = 0) {
  if (!fileUrl || typeof window === 'undefined') {
    return [];
  }

  if (fileSizeBytes > 0 && fileSizeBytes > MAX_WAVEFORM_FILE_BYTES) {
    return []; // skip — would load too much RAM on low-end devices
  }

  const AudioContextClass = getAudioContext();
  if (!AudioContextClass) {
    return [];
  }

  let audioContext;

  try {
    const response = await fetch(fileUrl);
    const arrayBuffer = await response.arrayBuffer();

    audioContext = new AudioContextClass();
    const audioBuffer = await audioContext.decodeAudioData(arrayBuffer.slice(0));

    const channelCount = audioBuffer.numberOfChannels || 1;
    const barTotal = Math.max(1, barCount);
    const sampleCount = audioBuffer.length;
    const samplesPerBar = Math.max(1, Math.floor(sampleCount / barTotal));
    const peaks = [];

    for (let i = 0; i < barTotal; i += 1) {
      const start = i * samplesPerBar;
      const end = Math.min(sampleCount, start + samplesPerBar);
      let max = 0;

      for (let channel = 0; channel < channelCount; channel += 1) {
        const channelData = audioBuffer.getChannelData(channel);

        for (let j = start; j < end; j += 1) {
          const value = Math.abs(channelData[j] || 0);
          if (value > max) {
            max = value;
          }
        }
      }

      peaks.push(max);
    }

    const maxPeak = Math.max(...peaks, 0.001);

    return peaks.map((peak) => {
      const normalized = peak / maxPeak;
      return Math.max(8, Math.round(normalized * 100));
    });
  } catch {
    return [];
  } finally {
    if (audioContext) {
      try {
        await audioContext.close();
      } catch {
        // ignore close failures
      }
    }
  }
}

