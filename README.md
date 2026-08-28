<p align="center">
  <img src="docs/assets/kledo-mcp-banner.png" alt="Pengguna menghubungkan klien AI ke Kledo melalui server MCP" width="100%">
</p>

<p align="center">
  <strong>Bahasa Indonesia</strong> | <a href="README.en.md">English</a>
</p>

# Kledo MCP

> [!IMPORTANT]
> **Ini bukan server MCP resmi dari Kledo.** Project open-source ini dibuat
> secara independen oleh pengguna Kledo, tanpa afiliasi, sponsor, dukungan,
> atau endorsement dari Kledo.
>
> Repo ini berawal dari kebutuhan sehari-hari: supaya data Kledo bisa ditanya
> lewat ChatGPT, Claude, Hermes, Codex, Cursor, atau klien MCP lainnya tanpa
> membuka akses tulis yang tidak perlu.
>
> Banyak bagian repo dikerjakan bareng AI coding agent. Maintainer manusia tetap
> pegang keputusan soal scope, keamanan, review, dan release.

Kledo MCP adalah jembatan
[Model Context Protocol](https://modelcontextprotocol.io/) yang minimal dan
read-only untuk membaca satu tenant Kledo yang dikonfigurasi oleh pengguna.
Saat ini sengaja cuma ada tiga tool. Endpoint mentah, credential, dan detail
pagination tidak pernah diberikan langsung ke model AI.

**Status:** masih preview `0.1.x`. Kontrak tool dijaga kecil sambil bentuk
response dan perilaku report terus dicek.

## Quick setup

Yang dibutuhkan:

- Node.js 22.19 atau lebih baru
- npm
- akses ke halaman Open API di tenant Kledo

```bash
git clone https://github.com/kevzakaria/kledo-mcp.git
cd kledo-mcp
npm ci
npm run setup
```

Wizard akan membangun server, membuka langsung **Pengaturan > Integrasi > Open
API**, menerima token lewat input terminal tersembunyi, lalu
menulis `.env` yang sudah diabaikan Git dan hanya bisa dibaca oleh pemilik file.
Validasi awal dilakukan secara lokal tanpa memanggil API Kledo.

Untuk mengisi katalog reference ID tenant sebelum query MCP pertama, jalankan:

```bash
npm run warmup
```

Command ini membaca master data read-only untuk salesperson, contact beserta
tipenya, contact group, product/category, warehouse, unit, dan finance account.
SQLite lokal hanya menyimpan ID, nama tampilan, status aktif, tenant scope, dan
timestamp yang sudah disanitasi. Output hanya menampilkan jumlah per jenis dan
waktu refresh.

Setelah wizard selesai, masukkan command yang dihasilkan ke klien MCP. Contoh
siap salin untuk Hermes, Codex, Claude Desktop, dan Cursor ada di
[panduan setup klien](docs/client-setup.md).

### Minta AI agent yang memasangnya

Kalau lebih nyaman dibantu coding agent, salin prompt ini ke agent atau AI
harness lokal pilihanmu:

```text
Pasang dan konfigurasikan kledo-mcp dari https://github.com/kevzakaria/kledo-mcp.

1. Clone repository dan pastikan Node.js 22.19 atau lebih baru serta npm tersedia.
2. Jalankan npm ci.
3. Jalankan npm run setup. Pause saat wizard meminta URL atau token Kledo supaya saya bisa mengisinya sendiri lewat input terminal tersembunyi.
4. Jangan pernah meminta token lewat chat, source code, command history, log, atau file yang akan di-commit.
5. Baca docs/client-setup.md lalu konfigurasikan klien MCP pilihan saya dengan environment variable atau secret manager yang saya pilih.
6. Jalankan npm run config:check dan npm test. Pastikan server hanya menyediakan kledo_query, kledo_get, dan kledo_report.
7. Jangan menambah tool, memanggil endpoint write Kledo, mengubah scope read-only, membuka secret, atau meng-commit .env.
8. Laporkan perubahan yang dibuat, hasil pengecekan, dan command persis yang akan dijalankan klien MCP saya.
```

Pakai secret manager lain atau ingin mengatur environment sendiri? Baca
[panduan konfigurasi dan secret](docs/configuration.md). Server hanya membaca
`KLEDO_API_BASE_URL`, `KLEDO_API_TOKEN`, dan `KLEDO_STATE_DIR` yang opsional
dari environment proses.

## Tiga tool read-only

| Tool | Fungsinya |
| --- | --- |
| `kledo_query` | Mencari atau membaca halaman entity Kledo yang ada di allowlist |
| `kledo_get` | Mengambil satu record yang sudah dinormalisasi beserta relasi terbatas |
| `kledo_report` | Menjalankan report native atau analisis semantic read-only yang ada di allowlist |

Tidak ada tool untuk membuat atau mengubah record, mengganti tenant saat tool
dipanggil, mengirim pesan, mengekspor file, atau menjalankan HTTP request bebas.
Daftar entity, report, contoh pertanyaan, dan status implementasi ada di
[referensi tool](docs/tool-reference.md).

Untuk pertanyaan penjualan per salesperson, `kledo_report` memakai
`sales_by_person`. `income_by_customer` tetap khusus untuk pengelompokan
customer. `sales_order_kpi` menghitung deal intake SO untuk periode dan
salesperson opsional dari seluruh halaman API; booked value bukan omset,
invoice, atau kas. `dormant_customers` mencari kandidat follow-up berdasarkan aktivitas
historis yang tidak muncul lagi di window terbaru, `receivable_by_invoice`
menjawab piutang per customer/invoice dan memetakan API `memo` ke Reference atau
proyek di Web UI, `item_price_analysis`
memisahkan harga katalog, harga transaksi terakhir, dan profitabilitas periode
untuk satu produk, dan `sales_by_period` khusus untuk bucket waktu. Kalau nama
produk cocok ke lebih dari satu barang, caller wajib mengulang dengan SKU yang
exact. Kandidat dormant bukan bukti customer sudah churn dan tidak memicu
pengiriman pesan. Mapping nama master reference disimpan di katalog SQLite lokal
yang terisolasi per tenant.
Mapping salesperson yang masih fresh sudah dipakai untuk merutekan report
dengan ID; jenis lain disiapkan untuk semantic routing berikutnya. Semua katalog
bisa diisi lebih dulu dengan `npm run warmup` tanpa menambah tool MCP baru.
Untuk Sales Invoice dan Purchase Invoice, `kledo_get` juga bisa mengembalikan
lineage bertipe `QU -> SO -> DO -> INV` / `PQ -> PO -> PD -> PI` serta event
`IP` / `PP` yang sudah dicocokkan dari sumber relasi dan transaksi Kledo,
tetap melalui tool yang sama. `purchase_quote` juga tersedia lewat
`kledo_query` dan `kledo_get` tanpa menambah tool publik baru.
## Versi MCP yang dipakai

Repo ini mengikuti revisi protokol MCP current,
[`2026-07-28`](https://modelcontextprotocol.io/specification/2026-07-28), dan
arsitektur server MCP 2.x. Tutorial untuk `2025-11-25` atau versi lebih lama
masih memakai handshake, jadi alur inisialisasinya memang berbeda.
Kompatibilitas `2025-06-18` tetap dites untuk klien lama.

Detailnya bisa dibaca di
[panduan versioning resmi MCP](https://modelcontextprotocol.io/docs/2026-07-28/learn/versioning)
dan [dokumen arsitektur repo](docs/architecture.md).

## Dokumentasi

| Panduan | Isi |
| --- | --- |
| [Konfigurasi](docs/configuration.md) | Wizard, setup manual, secret manager, dan beberapa tenant |
| [Setup klien](docs/client-setup.md) | Hermes, Codex, Claude Desktop, Cursor, dan MCP Inspector |
| [Referensi tool](docs/tool-reference.md) | Kontrak tool, katalog entity, report, dan contoh pertanyaan |
| [Peta siklus dokumen](docs/kledo-document-cycle-map.md) | Mapping QU/SO/DO/INV/IP dan PQ/PO/PD/PI/PP antara UI, API, dan MCP |
| [Arsitektur](docs/architecture.md) | Alur data, versi protokol, batasan, transport, dan safe failure |
| [Kebijakan keamanan](SECURITY.md) | Cara melaporkan celah keamanan dan menjaga credential |

## Issue dan kontribusi

Menemukan bug atau punya ide? Mulai dari
[GitHub issue chooser](https://github.com/kevzakaria/kledo-mcp/issues/new/choose).
Blank issue sengaja dimatikan supaya setiap laporan punya konteks yang cukup
untuk ditindaklanjuti.

Issue yang dibuat AI agent juga boleh. Cantumkan agent atau harness yang
dipakai, reviewer manusia jika ada, pisahkan fakta yang sudah diverifikasi dari
usulan, sertakan bukti yang sudah dibersihkan, dan tulis acceptance criteria
yang bisa dites. Jangan masukkan token, URL tenant, data pelanggan, nomor
invoice asli, response production mentah, local path, atau identifier privat.

Untuk feature request, mulai dari pertanyaan bisnis yang belum bisa dijawab
dengan aman. Jangan mengusulkan tool baru hanya karena endpoint Kledo tersedia.
Baca [CONTRIBUTING.md](CONTRIBUTING.md) sebelum mulai membuat perubahan. Celah
keamanan harus dilaporkan secara privat lewat [SECURITY.md](SECURITY.md).

## Lisensi dan merek dagang

Copyright 2026 Kledo MCP contributors. Dilisensikan dengan
[Apache License 2.0](LICENSE).

Kledo serta nama dan logo klien AI yang tampil di repo ini adalah merek dagang
pemilik masing-masing. Semuanya dipakai hanya untuk menunjukkan
interoperabilitas atau kemungkinan kompatibilitas, bukan afiliasi, sertifikasi,
sponsorship, atau endorsement.
