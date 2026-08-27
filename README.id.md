<p align="center">
  <img src="docs/assets/kledo-mcp-banner.png" alt="Pengguna menghubungkan klien AI ke Kledo melalui server MCP" width="100%">
</p>

<p align="center">
  <a href="README.md">English</a> | <strong>Bahasa Indonesia</strong>
</p>

# Kledo MCP

> [!IMPORTANT]
> **Ini bukan server MCP resmi dari Kledo.** Saya merawat proyek open-source
> independen ini sebagai pengguna Kledo. Proyek ini tidak berafiliasi,
> disponsori, didukung, atau memperoleh endorsement dari Kledo.
>
> Saya membuatnya karena membutuhkan penghubung read-only yang sempit antara
> Kledo dan AI agent atau harness yang mendukung MCP, seperti ChatGPT, Claude,
> Hermes, Codex, Cursor, dan klien kompatibel lainnya.
>
> Saya merawat repository ini dengan bantuan besar dari AI coding agent.
> Maintainer manusia tetap bertanggung jawab atas ruang lingkup, keamanan,
> review, dan release.

Kledo MCP adalah server
[Model Context Protocol](https://modelcontextprotocol.io/) yang minimal dan
read-only untuk membaca satu tenant Kledo yang dikonfigurasi oleh pengguna.
Saya menyediakan tepat tiga tool terbatas melalui stdio. Endpoint mentah,
credential, dan mekanisme pagination tidak diberikan langsung kepada model AI.

**Status:** preview `0.1.x`. Saya sengaja menjaga interface tetap kecil sambil
memverifikasi bentuk response dan perilaku report.

## Arsitektur MCP terkini

> [!NOTE]
> Saya mengembangkan dan menguji server ini menggunakan revisi protokol MCP
> terkini, [`2026-07-28`](https://modelcontextprotocol.io/specification/2026-07-28),
> dengan arsitektur server MCP 2.x. Panduan versioning resmi menandainya sebagai
> revisi current saat terakhir saya periksa pada 2026-08-27.
>
> Panduan MCP lama untuk `2025-11-25` dan sebelumnya menggunakan arsitektur
> protokol berbasis handshake. Karena itu, alur inisialisasi dan contoh server
> lama tidak langsung cocok dengan repository ini. Saya tetap menguji
> kompatibilitas `2025-06-18` untuk klien yang masih menegosiasikannya, tetapi
> pengembangan baru mengikuti `2026-07-28`.

Baca [panduan versioning MCP resmi](https://modelcontextprotocol.io/docs/2026-07-28/learn/versioning)
dan [panduan arsitektur proyek](docs/architecture.md) untuk detailnya.

## Setup cepat

Kebutuhan:

- Node.js 22.19 atau lebih baru
- npm
- akses ke halaman Open API pada tenant Kledo

```bash
git clone https://github.com/kevzakaria/kledo-mcp.git
cd kledo-mcp
npm ci
npm run setup
```

Wizard setup akan membangun server, mengarahkan Anda ke **Pengaturan > Integrasi > Open API**,
menerima token melalui input terminal tersembunyi, menulis `.env`
yang diabaikan Git dengan permission khusus pemilik, dan memvalidasi konfigurasi
lokal tanpa memanggil API Kledo.

Setelah itu, tambahkan command yang dihasilkan ke klien MCP. Contoh siap salin
tersedia untuk [Hermes, Codex, Claude Desktop, dan Cursor](docs/client-setup.md).

### Instal menggunakan AI agent pilihan Anda

Salin prompt berikut ke coding agent atau harness AI lokal yang Anda percaya:

```text
Instal dan konfigurasikan kledo-mcp dari https://github.com/kevzakaria/kledo-mcp.

1. Clone repository dan pastikan Node.js 22.19 atau lebih baru serta npm tersedia.
2. Jalankan npm ci.
3. Jalankan npm run setup. Berhenti sementara ketika wizard meminta URL atau token Kledo agar saya dapat memasukkannya langsung melalui input terminal tersembunyi.
4. Jangan pernah meminta saya menempelkan token ke chat, source code, command history, log, atau file yang akan di-commit.
5. Baca docs/client-setup.md dan konfigurasikan klien MCP pilihan saya menggunakan environment variable atau secret manager pilihan saya.
6. Jalankan npm run config:check dan npm test, lalu pastikan server hanya menyediakan kledo_query, kledo_get, dan kledo_report.
7. Jangan menambah tool, memanggil endpoint write Kledo, mengubah ruang lingkup read-only, membocorkan secret, atau meng-commit .env.
8. Laporkan perubahan yang dibuat, pemeriksaan yang berhasil, dan command persis yang akan dijalankan klien MCP saya.
```

Jika Anda menggunakan secret manager lain atau mengelola environment secara
manual, baca [konfigurasi dan pengelolaan secret](docs/configuration.md). Server
hanya membaca `KLEDO_API_BASE_URL` dan `KLEDO_API_TOKEN` dari environment proses.

## Tiga tool read-only

| Tool | Kegunaan |
| --- | --- |
| `kledo_query` | Mencari atau membaca halaman entity Kledo yang diizinkan |
| `kledo_get` | Mengambil satu record yang sudah dinormalisasi beserta relasi terbatas |
| `kledo_report` | Menjalankan report native Kledo yang diizinkan |

Saya tidak menyediakan tool untuk membuat atau mengubah record, mengganti
tenant saat tool dipanggil, mengirim pesan, mengekspor file, atau menjalankan
HTTP request secara bebas. Baca [referensi tool](docs/tool-reference.md) untuk
entity, report, contoh pertanyaan, dan status implementasi terkini.

## Dokumentasi

| Panduan | Isi |
| --- | --- |
| [Konfigurasi](docs/configuration.md) | Wizard, setup manual, pengelolaan secret, dan beberapa tenant |
| [Setup klien](docs/client-setup.md) | Hermes, Codex, Claude Desktop, Cursor, dan MCP Inspector |
| [Referensi tool](docs/tool-reference.md) | Kontrak tool, katalog entity, report, dan contoh pertanyaan |
| [Arsitektur](docs/architecture.md) | Alur data, target protokol, batasan, perilaku transport, dan safe failure |
| [Kebijakan keamanan](SECURITY.md) | Pelaporan vulnerability dan keamanan credential |

## Issue dan kontribusi

Saya menerima laporan bug dan usulan fitur melalui
[GitHub issue chooser](https://github.com/kevzakaria/kledo-mcp/issues/new/choose).
Blank issue dimatikan agar setiap laporan tetap dapat ditindaklanjuti.

Issue dari AI agent juga diterima. Issue harus menyebutkan agent atau harness,
nama reviewer manusia jika tersedia, memisahkan fakta terverifikasi dari usulan,
menyertakan bukti yang sudah dibersihkan, dan memberikan acceptance criteria
yang dapat diuji. Jangan menyertakan token, URL tenant, data pelanggan, nomor
invoice asli, response production mentah, local path, atau identifier integrasi
privat.

Permintaan fitur harus dimulai dari pertanyaan pengguna atau perusahaan yang
belum dapat dijawab dengan aman. Jangan meminta tool baru hanya karena endpoint
Kledo lain tersedia. Baca [CONTRIBUTING.md](CONTRIBUTING.md) sebelum membuat
implementasi, dan laporkan vulnerability secara privat melalui
[SECURITY.md](SECURITY.md).

## Lisensi dan merek dagang

Hak cipta 2026 kontributor Kledo MCP. Dilisensikan dengan
[Apache License 2.0](LICENSE).

Kledo serta nama dan logo klien AI yang ditampilkan adalah merek dagang pemilik
masing-masing. Saya menggunakannya hanya untuk menunjukkan interoperabilitas
atau kemungkinan kompatibilitas klien. Penggunaannya tidak menyatakan
afiliasi, sertifikasi, sponsorship, atau endorsement.
