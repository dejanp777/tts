/**
 * SSE (Server-Sent Events) Stream Parser
 * 
 * Parses SSE streams from Chat and TTS endpoints
 */

/**
 * Parse SSE stream and extract data
 * 
 * @param {Stream} stream - Readable stream from axios response
 * @param {Function} onData - Callback for each data chunk (token or audio)
 * @param {Boolean} isTTS - Whether this is a TTS stream (base64 audio) or chat stream (text tokens)
 * @returns {Promise<Array>} Array of all chunks received
 */
async function parseSSEStream(stream, onData, isTTS = false) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let buffer = '';

    stream.on('data', (chunk) => {
      buffer += chunk.toString();
      
      // Process complete SSE messages (ending with \n\n)
      const messages = buffer.split('\n\n');
      buffer = messages.pop() || ''; // Keep incomplete message in buffer

      for (const message of messages) {
        if (!message.trim()) continue;

        // Parse SSE format: "data: <content>"
        const lines = message.split('\n');
        for (const line of lines) {
          if (line.startsWith('data: ')) {
            const data = line.substring(6); // Remove "data: " prefix
            
            if (data === '[DONE]') {
              // Stream complete
              continue;
            }

            try {
              if (isTTS) {
                // TTS stream: Parse JSON with base64 audio
                const parsed = JSON.parse(data);
                if (parsed.type === 'chunk' && parsed.data) {
                  chunks.push(parsed.data);
                  if (onData) {
                    onData(parsed.data);
                  }
                } else if (parsed.type === 'done') {
                  // TTS stream complete
                  continue;
                } else if (parsed.type === 'error') {
                  reject(new Error(parsed.message || 'TTS stream error'));
                  return;
                }
              } else {
                // Chat stream: Parse JSON with delta content
                const parsed = JSON.parse(data);
                const token = parsed.choices?.[0]?.delta?.content || '';
                if (token) {
                  chunks.push(token);
                  if (onData) {
                    onData(token);
                  }
                }
              }
            } catch (e) {
              // If JSON parsing fails, treat as raw text (fallback)
              if (!isTTS) {
                chunks.push(data);
                if (onData) {
                  onData(data);
                }
              }
            }
          }
        }
      }
    });

    stream.on('end', () => {
      resolve(chunks);
    });

    stream.on('error', (error) => {
      reject(error);
    });
  });
}

/**
 * Parse chat SSE stream (convenience wrapper)
 */
async function parseChatStream(stream, onToken) {
  return parseSSEStream(stream, onToken, false);
}

/**
 * Parse TTS SSE stream (convenience wrapper)
 */
async function parseTTSStream(stream, onChunk) {
  return parseSSEStream(stream, onChunk, true);
}

module.exports = {
  parseSSEStream,
  parseChatStream,
  parseTTSStream,
};

