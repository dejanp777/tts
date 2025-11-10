# Natural Conversation Improvements Implementation Plan

## Phase 1: Immediate High-Impact Changes (Low Risk)
- [ ] 1. Reduce endpointing latency (maxSilenceMs: 2300ms → 800ms)
- [ ] 2. Add echo cancellation to getUserMedia constraints  
- [ ] 3. Keep mic live during AI speech (remove resetRecorder call)
- [ ] 4. Add volume ducking during user speech
- [ ] 5. Test Phase 1 changes

## Phase 2: Medium-Impact Additions (Medium Risk)
- [ ] 6. Add AbortController to chat/TTS fetches
- [ ] 7. Implement basic barge-in detection
- [ ] 8. Add feature flags system
- [ ] 9. Test Phase 2 changes

## Phase 3: Advanced Features (Higher Complexity)
- [ ] 10. Implement streaming chat tokens endpoint
- [ ] 11. Add chunked TTS support
- [ ] 12. Test Phase 3 changes

## Success Metrics
- Reduced latency between user speech end and AI response start
- Natural overlapping conversation capability
- No regressions in existing functionality
- Preserved browser compatibility
