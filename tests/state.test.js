import { describe, it, expect } from 'vitest';
import { initialState, reduce } from '../src/state.js';

const blob = { size: 1234 }; // stand-in; reducer never inspects the blob

describe('reduce', () => {
  it('starts recording from a clean slate', () => {
    const dirty = { ...initialState, rawTranscript: 'old', error: 'old' };
    const s = reduce(dirty, { type: 'RECORD_START' });
    expect(s).toEqual({ ...initialState, phase: 'recording' });
  });

  it('stop → transcribing with blob kept', () => {
    const s = reduce({ ...initialState, phase: 'recording' }, { type: 'RECORD_STOP', blob });
    expect(s.phase).toBe('transcribing');
    expect(s.audioBlob).toBe(blob);
  });

  it('TRANSCRIBE_OK releases the blob and moves to cleaning', () => {
    const before = { ...initialState, phase: 'transcribing', audioBlob: blob };
    const s = reduce(before, { type: 'TRANSCRIBE_OK', text: 'שלום', language: 'he' });
    expect(s.phase).toBe('cleaning');
    expect(s.rawTranscript).toBe('שלום');
    expect(s.language).toBe('he');
    expect(s.audioBlob).toBeNull(); // spec: release only after transcription succeeds
  });

  it('TRANSCRIBE_FAIL keeps phase and blob for retry', () => {
    const before = { ...initialState, phase: 'transcribing', audioBlob: blob };
    const s = reduce(before, { type: 'TRANSCRIBE_FAIL', message: 'boom' });
    expect(s.phase).toBe('transcribing');
    expect(s.audioBlob).toBe(blob);
    expect(s.error).toBe('boom');
  });

  it('TRANSCRIBE_RETRY clears the error', () => {
    const before = { ...initialState, phase: 'transcribing', audioBlob: blob, error: 'boom' };
    expect(reduce(before, { type: 'TRANSCRIBE_RETRY' }).error).toBeNull();
  });

  it('CLEANUP_OK reaches result', () => {
    const before = { ...initialState, phase: 'cleaning', rawTranscript: 'raw', language: 'he' };
    const s = reduce(before, { type: 'CLEANUP_OK', text: 'clean' });
    expect(s.phase).toBe('result');
    expect(s.cleanedText).toBe('clean');
    expect(s.error).toBeNull();
  });

  it('CLEANUP_FAIL still reaches result, with raw transcript and error', () => {
    const before = { ...initialState, phase: 'cleaning', rawTranscript: 'raw', language: 'he' };
    const s = reduce(before, { type: 'CLEANUP_FAIL', message: 'boom' });
    expect(s.phase).toBe('result');
    expect(s.cleanedText).toBeNull();
    expect(s.rawTranscript).toBe('raw');
    expect(s.error).toBe('boom');
  });

  it('CLEANUP_RETRY returns to cleaning and clears error', () => {
    const before = { ...initialState, phase: 'result', rawTranscript: 'raw', error: 'boom' };
    const s = reduce(before, { type: 'CLEANUP_RETRY' });
    expect(s.phase).toBe('cleaning');
    expect(s.error).toBeNull();
  });

  it('interruption flow: keep partial blob, user chooses transcribe', () => {
    const rec = { ...initialState, phase: 'recording' };
    const interrupted = reduce(rec, { type: 'RECORD_INTERRUPTED', blob });
    expect(interrupted.phase).toBe('interrupted');
    expect(interrupted.audioBlob).toBe(blob);
    const s = reduce(interrupted, { type: 'INTERRUPTED_TRANSCRIBE' });
    expect(s.phase).toBe('transcribing');
    expect(s.audioBlob).toBe(blob);
  });

  it('RESET returns to initial state', () => {
    const s = reduce({ ...initialState, phase: 'result', cleanedText: 'x' }, { type: 'RESET' });
    expect(s).toEqual(initialState);
  });

  it('unknown event is a no-op', () => {
    const s = reduce(initialState, { type: 'NOPE' });
    expect(s).toEqual(initialState);
  });
});
