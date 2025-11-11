# Advanced DDoS Tool v2.0

Tool untuk testing keamanan jaringan dengan fitur multi-layer attacks, proxy support, de-indexing, dan aggressive crawler.

## ⚠️ DISCLAIMER

Script ini hanya untuk tujuan edukasi dan testing sistem yang Anda miliki atau memiliki izin tertulis. Penggunaan tanpa izin adalah ILEGAL dan melanggar hukum.

## 📦 Installation

### 1. Install Node.js
Pastikan Node.js versi 12 atau lebih baru sudah terinstall.

### 2. Install Dependencies
```bash
npm install
```

Atau install manual:
```bash
npm install https-proxy-agent http-proxy-agent
```

## 🚀 Usage

### Basic Usage
```bash
node serang.js
```

### Dengan npm script
```bash
npm start
```

## 📋 Features

- ✅ Multi-layer attacks (L3-L7)
- ✅ Intensity control (low/medium/high/extreme)
- ✅ Proxy support (optional)
- ✅ Google de-indexing attacks
- ✅ Aggressive bot crawler
- ✅ Real-time statistics
- ✅ Logging system
- ✅ Cross-platform support

## 🔧 Configuration

### Proxy Setup
1. Buat file `proxies.txt` di folder yang sama
2. Format: `ip:port` atau `ip:port:user:pass`
3. Contoh:
```
192.168.1.1:8080
10.0.0.1:3128:username:password
proxy.example.com:1080
```

## 📝 Dependencies

- `https-proxy-agent`: Untuk proxy support HTTPS
- `http-proxy-agent`: Untuk proxy support HTTP

## ⚙️ Requirements

- Node.js >= 12.0.0
- npm atau yarn

## 📄 License

ISC

