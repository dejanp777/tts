/**
 * Response Cache Manager
 * 
 * Caches chat completion responses to reduce latency and API costs.
 * Uses in-memory Map storage with TTL (time-to-live).
 * 
 * Features:
 * - Cache common greetings and FAQs
 * - TTL-based expiration
 * - Cache hit/miss logging
 * - Statistics tracking
 */

class ResponseCache {
    constructor() {
        this.cache = new Map();
        this.stats = {
            hits: 0,
            misses: 0,
            sets: 0,
            evictions: 0
        };
        this.defaultTTL = 3600000; // 1 hour in milliseconds
        this.maxCacheSize = 100; // Maximum number of cached responses
    }

    /**
     * Generates cache key from message history
     * 
     * @param {Array} messages - Message history
     * @returns {string} Cache key
     */
    generateKey(messages) {
        // Use last 2 messages for key (system prompt + user message)
        const relevantMessages = messages.slice(-2);
        const keyString = relevantMessages
            .map(m => `${m.role}:${m.content}`)
            .join('|');

        // Simple hash function
        let hash = 0;
        for (let i = 0; i < keyString.length; i++) {
            const char = keyString.charCodeAt(i);
            hash = ((hash << 5) - hash) + char;
            hash = hash & hash; // Convert to 32-bit integer
        }

        return `cache_${hash}`;
    }

    /**
     * Gets cached response if available and not expired
     * 
     * @param {string} key - Cache key
     * @returns {string|null} Cached response or null
     */
    get(key) {
        const entry = this.cache.get(key);

        if (!entry) {
            this.stats.misses++;
            console.log('[Cache] MISS:', key);
            return null;
        }

        // Check if expired
        if (Date.now() > entry.expiresAt) {
            this.cache.delete(key);
            this.stats.evictions++;
            this.stats.misses++;
            console.log('[Cache] EXPIRED:', key);
            return null;
        }

        this.stats.hits++;
        console.log('[Cache] HIT:', key, `(age: ${Math.round((Date.now() - entry.createdAt) / 1000)}s)`);
        return entry.response;
    }

    /**
     * Sets cache entry with TTL
     * 
     * @param {string} key - Cache key
     * @param {string} response - Response to cache
     * @param {number} ttl - Time to live in milliseconds (optional)
     */
    set(key, response, ttl = this.defaultTTL) {
        // Evict oldest entry if cache is full
        if (this.cache.size >= this.maxCacheSize) {
            const firstKey = this.cache.keys().next().value;
            this.cache.delete(firstKey);
            this.stats.evictions++;
            console.log('[Cache] EVICTED:', firstKey, '(cache full)');
        }

        this.cache.set(key, {
            response,
            createdAt: Date.now(),
            expiresAt: Date.now() + ttl
        });

        this.stats.sets++;
        console.log('[Cache] SET:', key, `(TTL: ${ttl / 1000}s)`);
    }

    /**
     * Pre-caches common responses
     */
    preCacheCommonResponses() {
        const commonResponses = [
            {
                messages: [
                    { role: 'system', content: 'You are a helpful assistant.' },
                    { role: 'user', content: 'hi' }
                ],
                response: 'Hey there! How can I help?',
                ttl: 86400000 // 24 hours
            },
            {
                messages: [
                    { role: 'system', content: 'You are a helpful assistant.' },
                    { role: 'user', content: 'hello' }
                ],
                response: 'Hi! What can I do for you?',
                ttl: 86400000
            },
            {
                messages: [
                    { role: 'system', content: 'You are a helpful assistant.' },
                    { role: 'user', content: 'hey' }
                ],
                response: 'Hey! What\'s up?',
                ttl: 86400000
            },
            {
                messages: [
                    { role: 'system', content: 'You are a helpful assistant.' },
                    { role: 'user', content: 'how are you' }
                ],
                response: 'I\'m doing great, thanks! You?',
                ttl: 86400000
            },
            {
                messages: [
                    { role: 'system', content: 'You are a helpful assistant.' },
                    { role: 'user', content: 'thanks' }
                ],
                response: 'You\'re welcome!',
                ttl: 86400000
            },
            {
                messages: [
                    { role: 'system', content: 'You are a helpful assistant.' },
                    { role: 'user', content: 'thank you' }
                ],
                response: 'My pleasure!',
                ttl: 86400000
            }
        ];

        for (const { messages, response, ttl } of commonResponses) {
            const key = this.generateKey(messages);
            this.set(key, response, ttl);
        }

        console.log(`[Cache] Pre-cached ${commonResponses.length} common responses`);
    }

    /**
     * Gets cache statistics
     * 
     * @returns {Object} Cache stats
     */
    getStats() {
        const totalRequests = this.stats.hits + this.stats.misses;
        const hitRate = totalRequests > 0 ? (this.stats.hits / totalRequests * 100).toFixed(2) : 0;

        return {
            ...this.stats,
            size: this.cache.size,
            hitRate: `${hitRate}%`,
            totalRequests
        };
    }

    /**
     * Clears all cache entries
     */
    clear() {
        this.cache.clear();
        console.log('[Cache] Cleared all entries');
    }

    /**
     * Clears expired entries
     */
    clearExpired() {
        const now = Date.now();
        let cleared = 0;

        for (const [key, entry] of this.cache.entries()) {
            if (now > entry.expiresAt) {
                this.cache.delete(key);
                cleared++;
            }
        }

        if (cleared > 0) {
            console.log(`[Cache] Cleared ${cleared} expired entries`);
        }

        return cleared;
    }
}

module.exports = ResponseCache;
