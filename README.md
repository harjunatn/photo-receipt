# Struk Booth

Aplikasi photobooth mandiri yang mencetak foto di kertas struk thermal. Berjalan sebagai aplikasi web (PWA) di
**Google Chrome pada tablet Android**, dan berbicara langsung ke printer lewat USB atau Bluetooth — tanpa aplikasi
tambahan dan tanpa server.

## Alur tamu

1. **Pilih frame** — desain cetakan: Klasik, Kolase, Rol Film, Polaroid, Nota Belanja, Pesta, atau Potret.
2. **Pilih pembayaran** — QRIS, tunai, atau voucher.
3. **Sesi foto** — hitung mundur sebelum tiap jepretan.
4. **Edit & foto ulang** — tamu melihat struk persis seperti yang akan tercetak, lalu bisa mengganti gaya foto (Normal,
   Cerah, Kontras, Komik, Sketsa, Garis), mengganti frame, atau mengulang foto satu per satu.
5. **Cetak**.

Frame mana yang ditawarkan, harga, dan cara bayar diatur petugas di menu pengaturan (ikon ⚙ di layar awal).

## Yang dibutuhkan

| Alat | Catatan |
| --- | --- |
| Tablet Android + Google Chrome | Chrome wajib: hanya Chrome yang mengizinkan halaman web mengakses printer USB/Bluetooth. |
| Printer struk thermal 58 mm / 80 mm | Jenis ESC/POS (hampir semua printer kasir: iWare, Xprinter, Gprinter, EPPOS, Epson TM, dll.). |
| Kabel USB + OTG / USB hub Type-C | Untuk printer USB. Pilih hub dengan port daya (PD) supaya tablet tetap terisi. |
| Komputer (Mac/Windows/Linux) + Node.js 22.12 atau lebih baru | Hanya untuk menyiapkan dan memasang aplikasi. |

> **Tidak bisa di iPad/iPhone.** Safari tidak mengizinkan halaman web mengakses USB atau Bluetooth, jadi printer tidak
> bisa disambungkan dari sana.

## Mencoba di komputer

```bash
npm install
npm run dev
```

Buka `http://localhost:5173`. Tambahkan `?demo=1` di alamat (`http://localhost:5173/?demo=1`) untuk memakai **kamera
demo** bila komputer tidak punya kamera.

Untuk mencoba tanpa printer: tekan ikon ⚙ di pojok kanan bawah → PIN **1234** → tab **Printer** → pilih **Simulasi**.
Hasil cetak akan tampil di layar. Di Chrome komputer, printer USB/Bluetooth sungguhan juga bisa dihubungkan dan dites.

## Memasang di tablet

Kamera dan printer hanya diizinkan browser pada alamat **HTTPS**. Ada dua cara:

### A. Untuk dipakai sungguhan: unggah ke hosting HTTPS

```bash
npm run build
```

Unggah isi folder `dist/` ke layanan hosting statis apa pun yang memberi alamat HTTPS (misalnya Cloudflare Pages,
Netlify, Vercel, atau GitHub Pages — semuanya punya paket gratis). Buka alamatnya di Chrome tablet.

Aplikasi tidak mengirim foto atau data ke mana pun; hosting hanya menyimpan berkas aplikasinya. Setelah dibuka sekali,
aplikasi tersimpan di tablet dan **tetap jalan saat internet putus**.

#### Contoh: Vercel lewat GitHub

1. Buat repository kosong di GitHub, lalu kirim proyek ini ke sana dari folder proyek:

   ```bash
   git init -b main
   git add .
   git commit -m "Struk Booth versi pertama"
   git remote add origin https://github.com/<nama-akun>/<nama-repo>.git
   git push -u origin main
   ```

2. Di [vercel.com](https://vercel.com): **Add New → Project → Import** repository tadi. Vercel mengenali proyek ini
   sebagai **Vite** dengan sendirinya (perintah build `npm run build`, folder hasil `dist`) — tidak ada yang perlu diisi.
   Tekan **Deploy**.
3. Buka alamat produksinya (`https://<nama-proyek>.vercel.app`) di Chrome tablet. Pakai alamat produksi ini, bukan
   alamat *preview* per-commit: alamat preview biasanya meminta login Vercel.
4. Setiap `git push` ke `main` otomatis men-deploy versi baru. Booth yang sedang menyala mengambil versi baru itu
   sendiri saat layar sambutan sedang menganggur — tidak pernah di tengah sesi tamu.

Alamat itu bisa dibuka siapa saja, tapi itu tidak membuka data booth-mu: foto dan pengaturan tablet tersimpan di
masing-masing perangkat, dan data dashboard hanya terbuka untuk akun pemilik. Orang lain yang membuka alamatnya hanya
mendapat aplikasi kosong miliknya sendiri.

### B. Untuk uji cepat: lewat WiFi yang sama

```bash
npm run dev:lan
```

Terminal menampilkan alamat `Network: https://<alamat-ip>:5173/`. Buka alamat itu di Chrome tablet (tablet dan komputer
harus di WiFi yang sama). Chrome akan memperingatkan soal sertifikat — ketuk **Lanjutan → Lanjutkan ke situs**. Cara ini
hanya untuk percobaan: komputer harus tetap menyala.

### Setelah terbuka di tablet

1. **Pasang ke layar utama**: menu ⋮ Chrome → *Tambahkan ke layar utama* / *Instal aplikasi*. Aplikasi lalu tampil layar
   penuh tanpa bilah alamat.
2. **Sambungkan ke dashboard**: ⚙ → PIN → tab **Sambungan** (lihat *Memasangkan tablet* di bawah). Sebelum tersambung,
   layar tamu tidak menampilkan tombol mulai.
3. **Izinkan kamera**: jalankan satu sesi percobaan dan pilih *Izinkan* saat Chrome bertanya.
4. **Hubungkan printer**: ⚙ → PIN → tab **Printer** → pilih USB atau Bluetooth → **Hubungkan** → pilih printernya →
   **Tes cetak**.
5. **Ganti PIN petugas** di tab **Sistem** (bawaan: `1234`). PIN ini per tablet, tidak diatur dari dashboard.
6. **Kunci tablet di aplikasi ini**: Pengaturan Android → Keamanan → *Sematkan aplikasi* (App pinning), lalu sematkan
   Struk Booth. Tamu tidak bisa keluar ke aplikasi lain.
7. Atur layar agar **tidak mati otomatis** dan kecerahan cukup; aplikasi juga menahan layar tetap menyala.

## Dashboard pemilik dan beberapa tablet (Supabase)

**Wajib.** Setiap tablet harus tersambung ke dashboard sebelum bisa dipakai tamu, supaya semua sesi tercatat. Semua
tablet mengirim transaksinya ke satu tempat dan kamu melihat serta mengaturnya dari **dashboard**: alamat aplikasi dengan akhiran
`#dashboard` (misalnya `https://<nama-proyek>.vercel.app/#dashboard`), dibuka dari HP atau laptop.

| Menu dashboard | Isi |
| --- | --- |
| Dashboard | Omzet hari ini, 7 hari, bulan ini; grafik per hari; cara bayar; per perangkat; transaksi terbaru |
| Perangkat | Daftar tablet, kode perangkat + PIN, online/offline, status printer |
| Transaksi | Semua sesi dari semua tablet, saring tanggal / cara bayar / perangkat, unduh CSV |
| Voucher | Buat massal, status aktif / terpakai / kedaluwarsa; berlaku di semua tablet, sekali pakai |
| Koleksi Frame | Frame yang ditawarkan, per perangkat |
| Pengaturan | Nama outlet, warna, logo, teks struk, harga, cara bayar + gambar QRIS, password |

| Diatur di dashboard (sama untuk semua booth) | Diatur di tiap tablet (tergantung alatnya) |
| --- | --- |
| Harga, cara bayar, gambar QRIS, voucher | Printer dan kualitas cetak |
| Nama outlet, warna, logo, teks struk | Kamera, cermin, hitung mundur, suara, batas menganggur |
| Frame per perangkat | PIN petugas, layar penuh |
| Laporan semua booth | Ringkasan penjualan tablet itu, foto untuk cetak ulang |

### Menyiapkan (sekali saja)

1. Buat proyek di [supabase.com](https://supabase.com) (paket gratis cukup untuk mulai).
2. **SQL Editor → New query**: tempel seluruh isi [`supabase/schema.sql`](supabase/schema.sql), tekan **Run**.
3. **Authentication → Users → Add user**: buat akun pemilik (email + password, centang *Auto Confirm User*).
4. **Authentication → Sign In / Providers**: matikan *Allow new users to sign up*. Dashboard hanya menerima akun pertama
   yang masuk sebagai pemilik, tetapi tidak ada alasan membiarkan orang lain mendaftar.
5. **Project Settings → API**: salin *Project URL* dan *anon / publishable key*. Jangan pernah memakai `service_role`
   key di aplikasi ini.
6. Di Vercel: **Settings → Environment Variables**, tambahkan `VITE_SUPABASE_URL` dan `VITE_SUPABASE_ANON_KEY`, lalu
   **Redeploy**. (Untuk mencoba di komputer: salin `.env.example` menjadi `.env.local` dan isi di sana.)
7. Buka `…/#dashboard`, masuk dengan akun tadi. **Masuklah segera setelah deploy**: akun pertama yang masuk menjadi
   pemilik.

### Memasangkan tablet

1. Dashboard → **Perangkat** → tambah perangkat. Muncul **kode perangkat** dan **PIN**.
2. Di tablet: ⚙ → PIN petugas → tab **Sambungan** → ketik kode dan PIN itu → **Pasangkan**. Tablet yang belum
   tersambung langsung membuka tab ini.

Sesudah terpasang:

- Setiap sesi yang selesai dikirim ke dashboard. Kalau internet putus, transaksi **menunggu di tablet** dan terkirim
  sendiri saat internet kembali; booth tetap bisa dipakai.
- Perubahan di dashboard sampai ke tablet dalam satu-dua menit, saat layar sambutan (tidak pernah di tengah sesi tamu).
- Kalau perangkatnya dilepas atau dinonaktifkan di dashboard, booth berhenti menerima tamu baru. Tamu yang sedang di
  tengah sesi tetap bisa menyelesaikannya, dan transaksinya terkirim setelah tablet dipasangkan lagi.
- **Voucher** diperiksa ke server supaya satu kode tidak bisa dipakai di dua tablet. Karena itu voucher **butuh
  internet**; QRIS dan tunai tidak.
- Satu kode perangkat untuk satu tablet. Memasangkan tablet lain dengan kode yang sama melepas tablet sebelumnya.
- Foto tamu **tidak** dikirim ke server; hanya catatan transaksinya.

Paket gratis Supabase menjeda proyek yang tidak dipakai sekitar seminggu. Booth yang dipakai rutin tidak kena; setelah
libur panjang, bangunkan proyeknya dari dashboard Supabase (transaksi yang menunggu di tablet akan terkirim sesudahnya).

## Menghubungkan printer

- **USB** — paling stabil dan paling cepat. Sambungkan lewat OTG/hub, tekan **Hubungkan**, pilih printer di jendela
  Chrome, lalu izinkan. Kalau printer tidak muncul di daftar, nyalakan *Tampilkan semua perangkat USB*.
- **Bluetooth** — untuk printer dengan Bluetooth Low Energy (BLE). Jangan pairing dari pengaturan Android; cukup pilih
  printernya di jendela Chrome. Kalau printernya tidak muncul di daftar, ia memakai Bluetooth klasik — pakai **Serial**.
- **Serial** — untuk printer Bluetooth klasik: pairing dulu di pengaturan Bluetooth tablet, lalu tekan **Hubungkan** dan
  pilih printernya. Juga untuk adaptor serial.

Printer yang punya USB dan Bluetooth: pakai **USB** sebagai sambungan utama (lebih cepat dan stabil), Bluetooth sebagai
cadangan.
- **Simulasi** — tidak mencetak; hasil tampil di layar.

Setelah halaman dimuat ulang, aplikasi mencoba menyambung kembali sendiri. Jika printer baru saja dicabut atau
dimatikan, Chrome kadang meminta printer dipilih ulang lewat tombol **Hubungkan**.

### Menyetel hasil cetak

Kertas thermal mencetak lebih gelap daripada tampilan layar. Di tab **Printer → Kualitas cetak foto** ada pratinjau
titik-titik yang benar-benar dikirim ke printer. Ubah satu pengaturan, tekan **Tes cetak**, bandingkan:

| Masalah | Coba |
| --- | --- |
| Foto terlalu gelap | Naikkan *Gamma* atau *Kecerahan*, turunkan *Kepadatan hitam*. |
| Wajah pucat / hilang | Turunkan *Gamma* atau *Kecerahan*; coba pola *Floyd–Steinberg*. |
| Area gelap jadi blok hitam | Turunkan *Kepadatan hitam*, naikkan *Detail*. |
| Tepi kanan terpotong | Kecilkan *Lebar cetak (titik per baris)*. |
| Cetakan berantakan / berhenti di tengah | Bagian *Lanjutan* → **Stabil**. |
| Gambar jadi huruf acak | Bagian *Lanjutan* → format **ESC \***. |
| Kertas tidak terpotong | *Potong kertas* → pilih sesuai printer, atau *Tidak* untuk printer tanpa pemotong. |

## Pembayaran

Cara bayar yang dinyalakan di dashboard (menu **Pengaturan**) muncul sebagai pilihan di langkah pembayaran:

- **QRIS** — gambar QRIS toko kamu ditampilkan di layar. Tamu membayar, lalu petugas mengecek buktinya dan menekan
  *Petugas: konfirmasi bayar* dengan PIN. Pilihan ini baru muncul setelah gambar QRIS diunggah.
- **Tunai** — tamu membayar ke petugas, lalu petugas mengonfirmasi dengan PIN.
- **Voucher** — kode sekali pakai yang dibuat di dashboard (menu **Voucher**), berlaku di semua tablet. Tamu mengetik
  kodenya sendiri, jadi booth bisa jalan tanpa penjaga. Butuh internet.

Harga diatur di dashboard (menu **Pengaturan**) dan berlaku untuk semua frame. Dengan satu pilihan harga aktif, tamu langsung melihat harga
itu; dengan beberapa pilihan (misalnya 1 lembar dan 2 lembar), tamu memilihnya di langkah pembayaran. Harga 0 berarti
gratis: sesi langsung mulai.

**Belum ada:** QRIS otomatis (sesi mulai sendiri begitu pembayaran masuk, tanpa petugas). Itu butuh akun payment gateway
atas nama usahamu (Midtrans, Xendit, Tripay, dsb.) dan sebuah server kecil untuk menerima konfirmasi pembayaran.

## Yang belum ada

- QRIS otomatis (lihat di atas).
- Unduh foto lewat QR untuk tamu — butuh penyimpanan online. Saat ini petugas bisa mengunduh struk sebagai gambar dari
  tab **Riwayat**.
- Frame buatan sendiri (mengunggah desain bingkai) — saat ini tersedia tujuh frame bawaan; logo, judul, kutipan, kode
  QR, dan akun media sosial di struk bisa diatur sendiri.
- Stiker dan tulisan dari tamu di langkah edit — saat ini tamu bisa mengganti gaya foto, mengganti frame, dan foto ulang.
- Deteksi kertas habis — printer tidak dilaporkan statusnya; siapkan kertas cadangan dan cek berkala.
- Mencetak slip voucher di printer struk — saat ini kodenya disalin atau diunduh sebagai CSV dari dashboard.
- Voucher saat tablet sedang tanpa internet.
- Voucher yang bisa dipakai berkali-kali (satu kode untuk banyak tamu).
- Menu Event, dan pencairan dana: uang QRIS dan tunai langsung masuk ke kamu, jadi dashboard hanya mencatatnya.

## Privasi

Foto tamu hanya disimpan di tablet (untuk cetak ulang) dan tidak dikirim ke mana pun. Kalau dashboard dipakai, yang
dikirim ke Supabase hanya catatan transaksi (waktu, frame, harga, cara bayar, kode voucher) dan status tablet. Jumlah sesi yang disimpan bisa
diatur, dan penyimpanan bisa dimatikan sepenuhnya di tab **Riwayat**.

## Untuk pengembangan

```bash
npm run dev        # server pengembangan (http://localhost:5173)
npm run dev:lan    # sama, lewat HTTPS di jaringan lokal (untuk tablet)
npm test           # tes otomatis
npm run build      # periksa tipe + bangun ke dist/
npm run icons      # buat ulang ikon aplikasi
```

| Folder | Isi |
| --- | --- |
| `src/screens/` | Layar tamu: sambutan, pilih frame, pembayaran, kamera, edit, cetak. |
| `src/admin/` | Panel petugas. |
| `src/lib/image/` | Pengolahan foto menjadi titik hitam-putih (tone, dithering, gaya foto). |
| `src/lib/receipt/` | Penyusun tata letak struk dan desain frame (`frames.ts`). |
| `src/lib/printer/` | Perintah ESC/POS, koneksi USB/Bluetooth/serial, dan printer simulasi. |
| `src/lib/cloud/` | Sambungan tablet ke Supabase: pemasangan, antrean kirim transaksi, voucher, pengaturan bersama. |
| `src/dashboard/` | Dashboard pemilik (`#dashboard`); `?demo#dashboard` menampilkannya dengan data contoh. |
| `supabase/schema.sql` | Tabel, hak akses, dan fungsi di Supabase. |
| `tests/` | Tes untuk pengolahan gambar, ESC/POS, voucher, pembukuan, dan ringkasan dashboard. |
