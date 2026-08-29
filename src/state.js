export const initialState = {
  phase: 'idle', // idle | recording | transcribing | cleaning | result | interrupted
  audioBlob: null,
  rawTranscript: null,
  language: null,
  cleanedText: null,
  error: null,
  autoCopied: false,
};

export function reduce(state, event) {
  switch (event.type) {
    case 'RECORD_START':
      return { ...initialState, phase: 'recording' };
    case 'RECORD_STOP':
      return { ...state, phase: 'transcribing', audioBlob: event.blob, error: null };
    case 'RECORD_INTERRUPTED':
      return { ...state, phase: 'interrupted', audioBlob: event.blob };
    case 'INTERRUPTED_TRANSCRIBE':
      return { ...state, phase: 'transcribing', error: null };
    case 'TRANSCRIBE_OK':
      // Release the audio only now — a failed transcription must stay retryable.
      return { ...state, phase: 'cleaning', rawTranscript: event.text, language: event.language, audioBlob: null, error: null };
    case 'TRANSCRIBE_FAIL':
      return { ...state, error: event.message };
    case 'TRANSCRIBE_RETRY':
      return { ...state, error: null };
    case 'CLEANUP_OK':
      return { ...state, phase: 'result', cleanedText: event.text, error: null, autoCopied: event.autoCopied ?? false };
    case 'CLEANUP_FAIL':
      // Still show the result screen — the raw transcript is the fallback output.
      return { ...state, phase: 'result', cleanedText: null, error: event.message, autoCopied: event.autoCopied ?? false };
    case 'CLEANUP_RETRY':
      return { ...state, phase: 'cleaning', error: null, autoCopied: false };
    case 'REFINE_OK':
      return { ...state, cleanedText: event.text };
    case 'RESET':
      return { ...initialState };
    default:
      return state;
  }
}
