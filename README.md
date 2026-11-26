# Hello Snaply

Aplikasi photobooth mandiri yang mencetak foto di kertas struk thermal. Berjalan sebagai aplikasi web (PWA) di
**Google Chrome pada tablet Android**, dan berbicara langsung ke printer lewat USB atau Bluetooth — tanpa aplikasi
tambahan dan tanpa server.

## Alur tamu

1. **Pilih frame** — desain cetakan: Klasik, Kolase, Rol Film, Polaroid, Nota Belanja, Pesta, Potret, atau frame
   buatan franchise sendiri. Gambar tiap frame ditampilkan berwarna, seperti salinan digital yang diunduh tamu.
2. **Pilih pembayaran** — QRIS, tunai, atau voucher.
3. **Sesi foto** — hitung mundur sebelum tiap jepretan. Kalau harganya termasuk video, kamera diam-diam juga merekam
   1,5 detik di sekitar tiap jepretan untuk **boomerang** di dalam frame (tanpa tambahan waktu). Dashboard bisa
   menggantinya dengan satu langkah boomerang terpisah setelah foto terakhir.
4. **Edit & foto ulang** — tamu melihat struk persis seperti yang akan tercetak, lalu bisa mengganti gaya foto (Normal,
   Cerah, Kontras, Komik, Sketsa, Garis) atau mengulang foto satu per satu. (Pilihan ganti frame di langkah ini sedang
   disembunyikan; kodenya tetap ada, cukup hapus aturan `.frame-choice` di `src/styles.css` untuk menampilkannya lagi.)
5. **Cetak**. Di layar akhir ada tombol **Cetak ulang struk ini** untuk petugas (perlu PIN sekali per sesi), misalnya
   kalau dua tamu dalam satu foto masing-masing mau struknya. Tiap tekan mencetak satu lembar lagi, dan petugas memilih:
   **Tamu bayar** (harga satu lembar dari pilihan harganya, dicatat sebagai baris **Cetak ulang** tunai di riwayat) atau
   **Gratis, cetakan tadi rusak** (tidak dicatat). Baris cetak ulang menambah uang dan lembar, tetapi tidak dihitung
   sebagai sesi baru (di proyek Supabase yang sudah berjalan, jalankan ulang `supabase/schema.sql` sekali supaya
   hitungan sesi di dashboard mengikutinya). Hitungan mundur ke layar awal berhenti selama PIN diketik dan selama
   pilihan itu terbuka.

Frame mana yang ditawarkan, harga, dan cara bayar diatur di dashboard franchise; printer, kamera dan teks struk diatur
petugas di tablet (ikon ⚙ di layar awal).

### Frame buatan sendiri

Di dashboard → **Galeri Frame** → **+ Tambah frame**, franchise bisa mengunggah desainnya sendiri:

- Frame adalah gambar desain dengan tempat foto tamu (buat di Canva, Figma atau Photoshop). Lebar yang pas 1080 px;
  tingginya bebas sampai 6 kali lebarnya. Ada dua cara menandai tempat fotonya:
  - **PNG dengan lubang transparan** di tempat foto.
  - **JPG (atau PNG tanpa transparansi) dengan tempat foto diisi satu warna solid**, seperti *green screen*. Hijau
    #00FF00, magenta #FF00FF atau biru #0000FF dikenali sendiri; warna lain dipilih dengan mengetuk tempat foto pada
    gambar aslinya. Pakai warna yang tidak ada di bagian lain desain. Area warna itu dipotong jadi lubang, termasuk
    tepinya yang berbayang karena kompresi JPG; bintik kecil berwarna sama tidak ikut terpotong. **Kepekaan warna**
    bisa dinaikkan kalau tepi foto masih bergaris warna, atau diturunkan kalau bagian desain yang mirip ikut terpotong.
- **Satu foto per baris, turun ke bawah.** Kertas struk sempit, jadi foto yang berdampingan tercetak kecil; editor
  memberi peringatan kalau ada. Semua frame bawaan juga satu foto per baris.
- Tempat foto dikenali sendiri (1 sampai 6 foto), urut dari atas ke bawah lalu kiri ke kanan; urutannya bisa diubah
  dan area yang bukan untuk foto bisa dibuang. Bentuknya boleh bulat atau bersudut tumpul.
- Struk dicetak hitam-putih. Pilih **Tegas** untuk desain garis dan tulisan, **Halus** untuk desain berwarna atau
  bergradasi; pratinjau menunjukkan versi berwarna (untuk diunduh tamu) dan hasil cetaknya.
- Setelah disimpan, centang **Ditawarkan ke tamu** untuk tiap perangkat yang memakainya. Frame buatan sendiri hanya
  terlihat oleh franchise itu, dan tersimpan di tablet sehingga tetap bisa dipakai saat internet putus.

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
   git commit -m "Hello Snaply versi pertama"
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
   Hello Snaply. Tamu tidak bisa keluar ke aplikasi lain.
7. Atur layar agar **tidak mati otomatis** dan kecerahan cukup; aplikasi juga menahan layar tetap menyala.

## Dashboard, franchise, dan beberapa tablet (Supabase)

**Wajib.** Setiap tablet harus tersambung ke dashboard sebelum bisa dipakai tamu, supaya semua sesi tercatat. Semua
tablet mengirim transaksinya ke satu tempat dan dilihat serta diatur dari **dashboard**: alamat aplikasi dengan akhiran
`#dashboard` (misalnya `https://<nama-proyek>.vercel.app/#dashboard`), dibuka dari HP atau laptop.

Satu pemasangan aplikasi melayani banyak **franchise** (pemilik booth). Ada dua macam akun:

| Akun | Yang bisa dilakukan |
| --- | --- |
| **Superadmin** (pemilik platform) | Melihat dan mengubah semua franchise; membuat franchise dan akun adminnya; mengatur langganan; pengaturan platform |
| **Admin franchise** | Hanya franchise-nya sendiri: tablet, transaksi, voucher, frame, harga, cara bayar, akun DOKU-nya |

Data tiap franchise dipisahkan di database itu sendiri (*row level security*), bukan hanya di tampilan: akun sebuah
franchise tidak bisa membaca atau mengubah data franchise lain. Uang tamu masuk ke masing-masing franchise: tunai, QRIS
statis miliknya, atau akun DOKU-nya sendiri.

| Menu superadmin | Isi |
| --- | --- |
| Franchise | Daftar franchise: langganan, tablet online, sesi dan omzet 30 hari; tambah franchise; akun admin; **Buka dashboard-nya** |
| Pengaturan platform | Nama platform, tulisan kecil di layar tamu semua tablet, baris paling bawah semua struk, masa tenggang langganan |

Nama yang tampil mengikuti siapa pemilik tabletnya, tidak ada nama yang tertanam di aplikasi:

| Tempat | Nama yang tampil |
| --- | --- |
| Layar awal dan judul tab tablet yang **belum** dipasangkan | Nama platform (Pengaturan platform) |
| Layar awal dan judul tab tablet yang sudah dipasangkan | **Nama di layar tamu** dari Pengaturan franchise itu; kalau kosong, nama franchise-nya |
| Judul struk | Diketik di tiap tablet (⚙ → Struk); selama belum diisi, mengikuti nama di layar tamu |
| Judul tab dashboard | Nama franchise yang sedang dibuka · nama platform |

Tablet yang dipasangkan ke perangkat franchise lain membuang nama, logo, harga, cara bayar, dan pilihan frame dari
franchise sebelumnya. Yang diatur di tablet itu sendiri (printer, sesi, teks struk, PIN) tetap.

| Menu tiap franchise | Isi |
| --- | --- |
| Beranda | Omzet hari ini, 7 hari, bulan ini; grafik per hari; cara bayar; per perangkat; sesi terbaru |
| Booth Saya | Daftar tablet, kode perangkat + PIN (masing-masing dengan tombol salin), online/offline, status printer, kapan pengaturan tablet terakhir tersimpan |
| Riwayat Sesi | Jumlah uang dan sesi di atas, lalu saringan tanggal / cara bayar / perangkat, lalu daftar sesi dengan status pembayaran dan hasil foto. Tombol **Unduh** membuka pilihan Excel / PDF / CSV |
| Kasir QRIS | Setiap kode QR otomatis: lunas, tidak dibayar, dan "lunas tanpa sesi" yang perlu diperiksa |
| Kode Promo | Voucher: buat massal, status aktif / terpakai / kedaluwarsa; berlaku di semua tablet, sekali pakai. Tombol salin di samping tiap kode (kode yang pernah disalin ditandai "disalin"); voucher yang dipakai di booth langsung muncul saat itu juga tanpa memuat ulang (Supabase Realtime) |
| Galeri Frame | Satu daftar untuk semua frame: centang **Aktif** dan urutannya per booth; frame buatan sendiri punya **Edit** dan **Hapus** di kartunya, dan **+ Tambah frame** ada di kanan atas |
| Pengaturan | Nama outlet, warna, logo, harga, cara bayar + gambar QRIS, akun DOKU, password |

### Franchise dan langganan

- **Menambah franchise:** menu **Franchise** → isi nama dan email adminnya → **Tambah franchise**. Password sementara
  untuk admin itu ditampilkan sekali; **Salin semua** menyalin email, password, tautan dashboard, dan tautan aplikasi
  booth sekaligus, siap ditempel ke pesan untuknya. Saat pertama masuk ia diminta membuat password sendiri. Satu
  franchise boleh punya beberapa akun admin (tombol **Atur**). Lupa password: buat **Password baru** dari sana.
- **Menghapus franchise** (Atur → Hapus franchise) menghapus semua datanya beserta login admin-adminnya.
- **Batas per franchise:** 200 perangkat, 20 frame buatan sendiri, 20.000 voucher, supaya satu franchise tidak bisa
  memenuhi database yang dipakai bersama.
- **Langganan:** tiap franchise punya tanggal *berlaku sampai*. Perpanjang dengan tombol **+ 1 bulan / + 3 bulan /
  + 1 tahun** setelah pembayarannya kamu terima (pencatatannya manual). Kosong berarti tanpa batas, misalnya untuk booth
  milikmu sendiri.
- **Kalau langganan lewat:** selama masa tenggang (bawaan 7 hari, diatur di Pengaturan platform) booth tetap berjalan
  dan dashboard franchise menampilkan peringatan. Sesudahnya booth berhenti menerima tamu sampai diperpanjang; datanya
  tetap aman. Tablet yang sedang tanpa internet menghitung sendiri dari tanggal terakhir yang diketahuinya.
- **Menghentikan franchise:** matikan *Franchise aktif*. Semua booth-nya berhenti menerima tamu, apa pun tanggalnya.
- **Melihat sebagai franchise:** **Buka dashboard-nya** membuka semua menu franchise itu. Superadmin bisa mengubah apa
  pun di dalamnya, termasuk melihat hasil foto tamunya; sebaiknya ini disebut di perjanjian franchise.
- **Merek platform:** tulisan kecil di layar tamu (misalnya "didukung oleh jepretin") dan baris paling bawah struk
  (misalnya `@jepretin`) tampil di semua booth dan tidak bisa diubah franchise. Judul, kutipan dan teks struk lainnya
  tetap milik tiap tablet franchise.

Petugas di tiap booth juga bisa melihat penjualan **tablet itu sendiri** dari ⚙ → PIN → tab **Dashboard** (omzet hari
ini, 7 hari, bulan ini, grafik per hari) dan tab **Transaksi** (daftar sesi, saring cara bayar, unduh CSV), misalnya
untuk mencocokkan uang tunai di laci. Datanya diambil dari server, jadi butuh internet; tablet hanya bisa melihat
transaksinya sendiri.

| Diatur di dashboard franchise (sama untuk semua booth-nya) | Diatur di tiap tablet |
| --- | --- |
| Harga, cara bayar, gambar QRIS, voucher | Printer dan kualitas cetak |
| Nama outlet, warna, logo | Teks struk: judul, sub-judul, penutup, media sosial, kutipan, kode QR |
| | Kamera, cermin, hitung mundur, suara, batas menganggur |
| Frame per perangkat | PIN petugas, layar penuh |
| Laporan semua booth | Ringkasan penjualan tablet itu, foto untuk cetak ulang |

Teks struk diatur per tablet (⚙ → **Struk**) supaya tiap booth bisa punya nama dan kutipannya sendiri; logonya tetap
dari dashboard. Pengaturan di kolom kanan (kecuali layar penuh) diubah di tablet, tetapi salinannya ikut disimpan bersama
perangkatnya di dashboard. Jadi kalau tabletnya diganti, tablet baru yang dipasangkan dengan kode dan PIN yang sama
langsung memakai pengaturan printer, kualitas cetak, sesi & kamera, teks struk, riwayat dan PIN petugas yang sama. Printernya saja
yang perlu dihubungkan sekali lagi (pilih printer lewat tombol **Hubungkan**), karena izin printer melekat pada tablet.

### Menyiapkan (sekali saja)

1. Buat proyek di [supabase.com](https://supabase.com) (paket gratis cukup untuk mulai).
2. **SQL Editor → New query**: tempel seluruh isi [`supabase/schema.sql`](supabase/schema.sql), tekan **Run**.
3. **Authentication → Users → Add user**: buat akun superadmin (email + password, centang *Auto Confirm User*).
4. **Authentication → Sign In / Providers**: matikan *Allow new users to sign up*. Akun yang tidak terdaftar di
   franchise mana pun memang tidak bisa melihat apa-apa, tetapi tidak ada alasan membiarkan orang lain mendaftar.
5. **Project Settings → API**: salin *Project URL* dan *anon / publishable key*. Jangan pernah memakai `service_role`
   key di aplikasi ini.
6. Di Vercel: **Settings → Environment Variables**, tambahkan `VITE_SUPABASE_URL` dan `VITE_SUPABASE_ANON_KEY`, lalu
   **Redeploy**. (Untuk mencoba di komputer: salin `.env.example` menjadi `.env.local` dan isi di sana.)
7. Buka `…/#dashboard`, masuk dengan akun tadi. **Masuklah segera setelah deploy**: akun pertama yang masuk menjadi
   superadmin. Ini hanya terjadi **sekali**, di pemasangan yang masih kosong. Sesudahnya superadmin hanya bisa
   ditambah lewat SQL Editor, misalnya kalau akun itu terhapus:
   `insert into public.superadmins (user_id) select id from auth.users where email = 'email@kamu';`
8. Pasang fungsi server dan setel kunci induk untuk kunci pembayaran franchise (sekali; lihat juga bagian DOKU):

   ```bash
   supabase functions deploy
   ```

   ```bash
   supabase secrets set SECRETS_KEY="$(openssl rand -base64 32)"
   ```

9. Di menu **Franchise**, buat franchise pertama (misalnya untuk booth milikmu sendiri), lalu **Buka dashboard-nya**
   untuk menambah perangkat dan mengatur harganya.

**Pindah dari versi lama (satu pemilik).** Skema lama tidak bisa dinaikkan dengan menjalankan `schema.sql` saja.
Jalankan [`supabase/reset.sql`](supabase/reset.sql) dulu, lalu `schema.sql`. `reset.sql` **menghapus semua data
aplikasi** (akun login tidak), jadi tablet perlu dipasangkan ulang; salin dulu datanya kalau masih diperlukan.

### Memasangkan tablet

1. Dashboard franchise → **Booth Saya** → tambah perangkat. Muncul **kode perangkat** dan **PIN**. Perangkat itu milik
   franchise tersebut; tablet yang dipasangkan dengannya otomatis masuk ke franchise itu.
2. Di tablet: ⚙ → PIN petugas → tab **Sambungan** → ketik kode dan PIN itu → **Pasangkan**. Tablet yang belum
   tersambung langsung membuka tab ini.

Sesudah terpasang:

- Setiap sesi yang selesai dikirim ke dashboard. Kalau internet putus, transaksi **menunggu di tablet** dan terkirim
  sendiri saat internet kembali; booth tetap bisa dipakai.
- Perubahan di dashboard sampai ke tablet dalam satu-dua menit, saat layar sambutan (tidak pernah di tengah sesi tamu).
- Kalau perangkatnya dilepas atau dinonaktifkan di dashboard, booth berhenti menerima tamu baru. Tamu yang sedang di
  tengah sesi tetap bisa menyelesaikannya, dan transaksinya terkirim setelah tablet dipasangkan lagi.
- **Voucher** diperiksa ke server supaya satu kode tidak bisa dipakai di dua tablet. Karena itu voucher **butuh
  internet**; QRIS dan tunai tidak. Voucher hanya berlaku di tablet franchise yang membuatnya.
- Satu kode perangkat untuk satu tablet. Memasangkan tablet lain dengan kode yang sama melepas tablet sebelumnya, dan
  tablet baru itu memakai pengaturan tablet sebelumnya (lihat di atas).
- Hasil foto berframe setiap sesi dikirim ke Cloudflare R2 dan dihapus otomatis setelah 3 hari (lihat *Unduh foto
  lewat QR*).

Paket gratis Supabase menjeda proyek yang tidak dipakai sekitar seminggu. Booth yang dipakai rutin tidak kena; setelah
libur panjang, bangunkan proyeknya dari dashboard Supabase (transaksi yang menunggu di tablet akan terkirim sesudahnya).

## Unduh foto lewat QR (Cloudflare R2)

Setiap sesi selalu mendapat kode QR unduhan. Tamu men-scan-nya dan membuka halaman berisi **foto berwarna dengan frame**
(tata letak sama dengan struk, resolusi 1080 piksel), bisa diunduh selama **3 hari**. Setelah itu berkasnya dihapus
otomatis.

Kode QR-nya selalu muncul di layar akhir sesi, di tab **Riwayat** dan **Transaksi** tablet, dan di dashboard →
**Riwayat Sesi**. Dashboard → **Pengaturan → Unduh foto lewat QR → Cetak kode QR di struk** (bawaannya menyala) hanya
menentukan apakah kodenya juga dicetak. Mematikannya membuat struk lebih pendek; tamu lalu men-scan kode dari layar.

Untuk harga yang dicentang **Termasuk boomerang & video slideshow** (dashboard → Pengaturan → Harga; bawaannya
tercentang), halaman itu juga berisi dua video MP4 yang bisa diputar di iPhone maupun Android:

| Video | Isinya |
| --- | --- |
| **Boomerang** | Bawaannya **di dalam frame**: struk berwarna pilihan tamu, tapi tiap fotonya bergerak maju-mundur 3 kali (±4,5 detik). Rekamannya diambil diam-diam dari 0,5 detik sebelum sampai 1 detik sesudah tiap jepretan (foto ulang ikut merekam ulang), dan mengikuti potongan foto yang diatur tamu. Stiker atau desain frame yang menimpa foto tetap di atasnya. Kalau dashboard → Pengaturan → Unduh foto lewat QR → Boomerang diubah ke **Sesi terpisah di akhir**: satu rekaman 1,5 detik layar penuh setelah foto terakhir, dengan nama outlet dan baris platform kecil di bawah |
| **Video Slideshow** | Foto-foto sesi berwarna satu per satu (sesuai potongan tamu), lalu struk berwarna bergulir. Tegak 9:16, pas untuk Story Instagram/TikTok. Tanpa musik |

- Video dibuat di tablet sendiri dengan encoder bawaan Chrome, jadi tidak ada server atau biaya tambahan. Ukurannya
  sekitar 1 MB (boomerang) dan 2 MB (slideshow) per sesi. Boomerang di dalam frame selebar 720 piksel, atau lebih
  sempit untuk struk yang panjang (paling tinggi 1920 piksel, dan lebih kecil lagi kalau encoder tablet menolak).
- Foto tetap dikirim lebih dulu. Halaman unduh menampilkan "sedang dibuat" untuk video yang belum sampai dan memeriksa
  lagi sendiri.
- Tablet yang browsernya tidak bisa membuat video MP4 tidak menawarkan boomerang (tab **Sambungan** memberi tahu); foto
  tetap berjalan seperti biasa.

Cara kerjanya:

- Setiap sesi mendapat kode acak 12 huruf yang sulit ditebak. Kode itulah isi QR-nya (`…/#s/kodenya`).
- Setelah sesi selesai, tablet membuat foto berwarna dan mengunggahnya **langsung ke R2** lewat alamat sementara dari
  Supabase. Kunci R2 tidak pernah ada di tablet. Kalau internet putus, berkasnya menunggu di tablet (tab
  **Sambungan** menunjukkan jumlahnya) dan terkirim sendiri nanti.
- Halaman unduh meminta tautan sementara (berlaku 1 jam) ke Supabase setiap kali dibuka. Bucket-nya tetap privat.
- Dashboard → **Riwayat Sesi** menampilkan gambar kecil hasil foto, tombol **QR** (menampilkan kode QR-nya lagi kalau
  struk tamu hilang) dan tombol **mata** (membuka halaman hasilnya). Tab **Transaksi** di tablet juga punya tombol QR.

### Menyiapkan R2 (sekali saja)

Letak menu di bawah ini ditulis dari ingatan dan bisa sedikit berbeda di dashboard Cloudflare.

1. Cloudflare → **R2** → aktifkan R2 (Cloudflare biasanya meminta kartu atau PayPal walaupun tetap di kuota gratis).
2. **Create bucket**, misalnya `hello-snaply-hasil`.
3. Bucket → **Settings → Object lifecycle rules → Add rule**: awalan (prefix) `s/`, hapus objek setelah **3 hari**.
4. Bucket → **Settings → CORS policy**, isi (ganti alamatnya dengan alamat Vercel-mu):

   ```json
   [
     {
       "AllowedOrigins": ["https://<nama-proyek>.vercel.app"],
       "AllowedMethods": ["PUT", "GET", "HEAD"],
       "AllowedHeaders": ["content-type"],
       "MaxAgeSeconds": 3600
     }
   ]
   ```

5. R2 → **Manage R2 API Tokens → Create API token**: izin *Object Read & Write*, batasi ke bucket tadi. Catat
   **Access Key ID** dan **Secret Access Key** (hanya ditampilkan sekali). **Account ID** ada di halaman R2.
6. Supabase → Edge Functions → Secrets: isi `R2_ACCOUNT_ID`, `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`, `R2_BUCKET`.
7. Selesai: setiap sesi langsung mendapat kode QR unduhan. Di dashboard → **Pengaturan → Unduh foto lewat QR** bisa
   dipilih apakah kodenya juga dicetak di struk.

Masa simpan 3 hari tertulis di tiga tempat yang harus sama: aturan hapus di bucket R2, `SHARE_DAYS` di
[`src/lib/cloud/shared.ts`](src/lib/cloud/shared.ts), dan `interval '3 days'` di fungsi `share_claim` pada
[`supabase/schema.sql`](supabase/schema.sql).

## Versi koran di halaman unduh

Setiap sesi juga dibuat sebagai halaman depan koran (tab **Koran** di halaman unduh): nama lokasi sebagai judul besar,
foto pertama sebagai foto utama, foto lain di bawahnya, dan "berita" jenaka dalam tiga kolom. Tanpa AI dan tanpa biaya:
tablet menggambarnya sendiri begitu sesi selesai (1240 × 1860 px, perbandingan 2:3 seperti kertas foto 4R) dan
mengunggahnya bersama berkas lain.

- **Yang bisa diatur hanya judul besarnya:** di tablet, ⚙ → **Struk → Koran → Judul besar (nama lokasi)**, misalnya
  `CIBINONG`. Kalau kosong, nama booth yang dipakai. Di kotak yang sama ada contoh hasilnya dan centang **Buat versi
  koran** untuk mematikannya.
- Fotonya dipakai utuh seperti saat dijepret (tidak dipotong mengikuti lubang frame), supaya semua orang tetap masuk.
- Desain dan teks beritanya ada di [`src/lib/newspaper.ts`](src/lib/newspaper.ts).

## Edit foto AI di halaman unduh (Gemini)

Kalau dinyalakan, halaman unduh tamu mendapat tab **Versi AI**: tamu memilih satu foto dari sesinya dan satu gaya
(Kartun 3D, Anime, Komik, Cat air, Karikatur), lalu fotonya digambar ulang oleh model gambar Gemini milik Google.
Gratis 1 kali per sesi untuk tamu; biayanya (sekitar Rp550 sampai Rp750 per foto ukuran 1K, tergantung model) dibayar
pemilik platform lewat API key-nya. Fitur ini dijual per franchise, jadi dinyalakan per franchise.

- **Menyalakan:** dashboard → **Franchise → Atur → Edit foto AI → Aktif untuk franchise ini**, lalu Simpan. Bawaannya
  mati, dan hanya superadmin yang bisa mengubahnya (admin franchise tidak). Di kotak yang sama: batas foto per bulan
  untuk franchise itu (bawaan 300) dan pemakaiannya bulan ini. Kartu franchise menampilkan tanda **AI** saat menyala.
- **Pengaturan platform → Edit foto AI** menampilkan status API key dengan tombol **Periksa API key** (bertanya ke
  Google apakah kuncinya diterima; gratis) dan pemakaian bulan ini di semua franchise.
- **API key:** Supabase → **Edge Functions → Secrets** → tambah `GEMINI_API_KEY` (dari Google AI Studio, proyek yang
  billing-nya aktif: keluaran gambar tidak punya kuota gratis). Kuncinya hanya dibaca fungsi `share-ai`; ia tidak
  pernah dikirim ke browser atau tablet. Dua pengaturan lain boleh ditambah di tempat yang sama:
  `GEMINI_IMAGE_MODEL` (bawaan `gemini-nano-banana-2.1`; `gemini-3.1-flash-lite-image` lebih murah karena masukan dan
  "berpikir"-nya lebih murah, dengan harga gambar yang sama) dan `GEMINI_IMAGE_SIZE` (`1K`, `2K` atau `4K`; bawaan
  `1K`). Mengubah secret tidak butuh deploy ulang.
- **Yang berubah saat menyala:** tablet franchise itu ikut mengunggah foto tiap jepretan tanpa frame (paling banyak 6, sisi
  terpanjang 1280 px), karena kalau hasil ber-frame yang dikirim, AI ikut menggambar ulang frame dan tulisannya. Foto
  polos dan hasil AI disimpan di R2 bersama berkas sesi lain dan terhapus setelah 3 hari.
- **Penjagaan biaya, semuanya di server:** satu hasil per kode QR; percobaan yang gagal atau ditolak AI tidak memakai
  jatah, tetapi setelah tiga kali gagal tawarannya ditutup; batas bulanan per franchise; dan tamu hanya bisa mengirim
  nama gaya dari daftar, bukan perintah sendiri (teks perintahnya ada di
  [`supabase/functions/_shared/styles.ts`](supabase/functions/_shared/styles.ts), tempat menambah atau mengubah gaya).
- **Kalau gagal:** alasan kegagalan terakhir tampil di kartu **Pemakaian bulan ini**, dan lengkapnya ada di log fungsi
  `share-ai` di Supabase.

Fungsinya memanggil Interactions API Gemini lebih dulu (cara yang didokumentasikan Google untuk mengedit foto dengan
model ini) dan `generateContent` sebagai cadangan.

## Menghubungkan printer

- **USB** — paling stabil dan paling cepat. Sambungkan lewat OTG/hub, tekan **Hubungkan**, pilih printer di jendela
  Chrome, lalu izinkan. Kalau printer tidak muncul di daftar, nyalakan *Tampilkan semua perangkat USB*.
- **Serial** — **cara yang dianjurkan untuk printer Bluetooth yang punya PIN** (tercantum di halaman tes printer,
  misalnya P7A dengan PIN 0000). Ini Bluetooth "biasa", jalur yang juga dipakai aplikasi printer Android pada umumnya.
  Juga untuk printer dengan adaptor serial. Butuh Chrome versi 138 ke atas.
- **Bluetooth** — Bluetooth Low Energy (BLE), untuk printer yang hanya punya BLE. Tidak perlu pairing di Android;
  printer dipilih di jendela Chrome. Di beberapa printer dan HP sambungannya kurang stabil, dan setiap kali aplikasi
  dimuat ulang atau diperbarui, printer BLE harus dihubungkan ulang dengan tangan.
- **Simulasi** — tidak mencetak; hasil tampil di layar.

Printer yang punya USB dan Bluetooth: pakai **USB** sebagai sambungan utama, Bluetooth (Serial) sebagai cadangan.

### Menyambungkan printer Bluetooth lewat Serial (sekali saja per tablet)

1. Nyalakan printer.
2. Di tablet: **Pengaturan → Koneksi → Bluetooth**, pindai, ketuk nama printernya (misalnya **P7A**), lalu masukkan PIN
   dari halaman tes printer (biasanya `0000` atau `1234`).
3. Di aplikasi: ⚙ → PIN petugas → **Printer** → Jenis koneksi **Serial** → **Hubungkan** → pilih printernya.
4. Tekan **Tes cetak**.

Setelah itu printer tidak perlu dipilih lagi: aplikasi menyambung sendiri saat dibuka, setelah dimuat ulang atau
diperbarui, dan tepat sebelum mencetak kalau sambungannya sedang lepas. Android tidak mengabarkan kalau printer mati,
jadi kalau printer sempat dimatikan, cetakan pertama sesudahnya bisa gagal. Aplikasi lalu menyambung lagi sendiri paling
lama sekitar 30 detik setelah printer menyala, atau langsung saat petugas menekan **Coba cetak lagi**. Jangan
menyambungkan printer yang sama ke dua tablet sekaligus: printer seperti ini hanya melayani satu perangkat dalam satu
waktu.

**Printer Bluetooth (BLE) terputus dan tidak mau tersambung lagi** (lampu printer tetap menyala biru, tablet terus
"menghubungkan"). Kalau printernya punya PIN, cara termudah adalah pindah ke **Serial** seperti di atas. Untuk BLE: printer masih menganggap sambungan lama aktif. Aplikasi mencoba tiga kali (membuka sambungan paling
lama 12 detik, membaca isi printer paling lama 25 detik), dan menutup sambungan lama di antaranya. Kalau tetap gagal:

1. Matikan printer, tunggu 5 detik, nyalakan lagi sampai lampunya **berkedip** (siap disambungkan).
2. Tekan **Hubungkan** di tab Printer.
3. Kalau masih gagal: matikan lalu nyalakan Bluetooth tablet, atau muat ulang aplikasinya.
4. Pastikan tidak ada aplikasi lain (aplikasi bawaan printer, aplikasi kasir) yang sedang tersambung ke printer itu,
   dan printer tidak di-*pair* lewat pengaturan Bluetooth Android. Printer BLE hanya menerima satu sambungan.

**"Printer tersambung, tetapi jalur cetaknya tidak terbaca"** atau **"tidak dikenali sebagai printer struk"** padahal
printer yang sama sebelumnya bisa: Android menyimpan daftar isi printer di cache, dan cache itu bisa rusak setelah
sambungan putus di tengah jalan. Hapus cache Bluetooth Android: **Pengaturan → Aplikasi → tampilkan aplikasi sistem →
Bluetooth → Penyimpanan → Hapus cache** (jangan *Hapus data*, itu menghapus semua perangkat yang tersimpan), matikan
lalu nyalakan Bluetooth, lalu **Hubungkan** lagi. Kalau pesannya menyebut "Layanan yang terbaca: …", kirim daftar itu
ke pengembang: printernya memakai jalur cetak yang belum dikenal aplikasi.

Sambungan yang sering putus biasanya karena jarak atau halangan, baterai printer lemah, atau printer masuk mode hemat
daya. Kalau printernya punya USB, USB tetap paling stabil untuk booth.

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
| Cetakan berantakan / berhenti di tengah | Bagian *Lanjutan* → **Stabil**. Lihat juga *Masalah cetak terakhir* di bawah. |
| Gambar jadi huruf acak | Bagian *Lanjutan* → format **ESC \***. |
| Struk setelah cetakan yang terputus diawali huruf Cina acak | Sudah ditangani otomatis: setelah cetakan terputus, cetakan berikutnya diawali sedikit kertas kosong yang menyelesaikan gambar yang terpotong. |

Tab **Printer** juga menyimpan **Masalah cetak terakhir** (20 terakhir): kapan, lewat apa, sampai berapa persen, dan
pesannya. Terputus di persen yang acak biasanya kabel atau adaptor OTG yang longgar; selalu terputus di frame yang
banyak hitamnya biasanya daya printer yang kurang. Printer USB yang menolak data sebentar (status *stall*) dicoba lagi
sampai tiga kali sebelum cetakan dianggap gagal.
| Kertas tidak terpotong | *Potong kertas* → pilih sesuai printer, atau *Tidak* untuk printer tanpa pemotong. |

## Pembayaran

Cara bayar yang dinyalakan di dashboard (menu **Pengaturan**) muncul sebagai pilihan di langkah pembayaran:

- **QRIS otomatis (DOKU)** — tablet membuat kode QR khusus untuk sesi itu dengan nominal yang sudah terisi. Begitu
  pembayaran masuk, sesi foto mulai sendiri, tanpa petugas. Lihat *QRIS otomatis lewat DOKU* di bawah.
- **QRIS manual** — gambar QRIS toko kamu ditampilkan di layar. Tamu membayar, lalu petugas mengecek buktinya dan menekan
  *Petugas: konfirmasi bayar* dengan PIN. Pilihan ini baru muncul setelah gambar QRIS diunggah.
- **Tunai** — tamu membayar ke petugas, lalu petugas mengonfirmasi dengan PIN.
- **Voucher** — kode sekali pakai yang dibuat di dashboard (menu **Kode Promo**), berlaku di semua tablet. Tamu mengetik
  kodenya sendiri, jadi booth bisa jalan tanpa penjaga. Butuh internet.

**Konfirmasi petugas.** Untuk tunai dan QRIS manual, tiap franchise bisa mematikan *Perlu konfirmasi petugas (PIN)* di
dashboard → Pengaturan → Cara bayar (bawaannya menyala, masing-masing sendiri). Tanpa konfirmasi, tamu menekan *Sudah
bayar · mulai foto* sendiri: lebih cepat untuk booth yang selalu dijaga, tetapi siapa pun bisa memulai sesi tanpa
membayar dan sesi itu tetap tercatat sebagai uang masuk. Karena itu sesinya ditandai **tanpa PIN** di menu
Riwayat Sesi dan di unduhan Excel/PDF/CSV, supaya bisa dicocokkan dengan uang yang diterima. Booth tanpa penjaga
sebaiknya hanya menyalakan QRIS otomatis (dan voucher), yang memeriksa pembayarannya sendiri.

Harga diatur di dashboard (menu **Pengaturan**) dan berlaku untuk semua frame. Dengan satu pilihan harga aktif, tamu langsung melihat harga
itu; dengan beberapa pilihan (misalnya 1 lembar dan 2 lembar), tamu memilihnya di langkah pembayaran. Harga 0 berarti
gratis: sesi langsung mulai.

### QRIS otomatis lewat DOKU

Tiap franchise dibayar ke **akun DOKU-nya sendiri**. Kuncinya diisi oleh admin franchise (atau superadmin) di
dashboard → **Pengaturan → Cara bayar → QRIS → Otomatis (DOKU)** → bagian **Akun DOKU franchise ini**:

| Isian | Dari mana |
| --- | --- |
| Client ID | DOKU Back Office → Integration → API Keys (`BRN-…`) |
| Secret Key | Halaman yang sama |
| Merchant ID (QRIS) | Settings → Checkout Appearance → Pengaturan Kredensial QRIS (angka pendek, bukan NMID/MPAN) |
| Terminal ID | Misalnya `A01` |
| Kode pos | Kode pos lokasi usaha, 5 angka |
| Pasangan kunci | **Buat pasangan kunci baru** di halaman itu, lalu tempel *public key*-nya di DOKU sebagai Merchant Public Key. Atau tempel private key yang sudah ada |
| Notification URL | Disalin dari halaman itu ke DOKU Back Office |

Lalu **Simpan kunci** dan **Tes koneksi**: aplikasi mencoba kuncinya ke DOKU tanpa membuat tagihan, dan menyebutkan
bagian mana yang ditolak kalau ada.

Kunci rahasia (Secret Key dan private key) tidak pernah ada di tablet, di Vercel, atau di GitHub. Keduanya disimpan
**terenkripsi** di database dengan kunci induk `SECRETS_KEY`, yang hanya ada sebagai *secret* di Supabase, dan tidak
pernah dikirim kembali ke dashboard: kunci hanya bisa diganti atau dihapus. Jangan mengganti `SECRETS_KEY` setelah ada
franchise yang menyimpan kunci; kunci tersimpan jadi tidak bisa dibuka dan harus diisi ulang.

Fungsi server di [`supabase/functions`](supabase/functions):

| Fungsi | Tugas |
| --- | --- |
| `qris-create` | Membuat kode QR untuk satu sesi dengan kunci franchise tablet itu. Nominal diambil dari harga di dashboard, bukan dari tablet. |
| `qris-status`, `qris-cancel`, `qris-sweep` | Menanyakan ke DOKU apakah QR sudah dibayar, menutup QR yang ditinggalkan. |
| `doku-notify` | Menerima pemberitahuan pembayaran dari DOKU; tanda tangannya diperiksa dengan kunci franchise pemilik tagihan itu. |
| `doku-setup` | Menyimpan, mencoba dan menghapus kunci DOKU sebuah franchise. Hanya untuk akun franchise itu dan superadmin. |
| `admin` | Membuat, memberi password baru dan menghapus akun admin franchise. Hanya untuk superadmin. |

**1. Jalankan [`supabase/schema.sql`](supabase/schema.sql)** di SQL Editor (aman diulang).

**2. Setel kunci induk** (sekali; nilainya tidak perlu kamu lihat atau simpan di tempat lain):

```bash
supabase secrets set SECRETS_KEY="$(openssl rand -base64 32)"
```

Kunci DOKU yang dulu diisi langsung sebagai secret (`DOKU_CLIENT_ID`, `DOKU_SECRET_KEY`, `DOKU_PRIVATE_KEY`,
`DOKU_MERCHANT_ID`, `DOKU_TERMINAL_ID`, `DOKU_POSTAL_CODE`) masih dipakai untuk **satu** franchise, yaitu yang id-nya
diisi di secret `DOKU_ENV_FRANCHISE`, selama franchise itu belum menyimpan kuncinya sendiri di dashboard. Franchise
lain selalu memakai kunci yang mereka simpan. Opsional: `DOKU_QR_MINUTES` (masa berlaku QR, bawaan 5 menit).

Private key yang ditempel harus kunci **privat** RSA (`-----BEGIN PRIVATE KEY-----` atau
`-----BEGIN RSA PRIVATE KEY-----`), pasangan dari Merchant Public Key yang terdaftar di DOKU. Mengganti Merchant Public
Key di DOKU membuat kunci lama tidak berlaku, termasuk di aplikasi lain yang memakai akun DOKU yang sama. Kunci yang
dikunci password (`ENCRYPTED PRIVATE KEY`) dibuka dulu dengan `openssl pkey -in kunci.pem -out kunci-terbuka.pem`.

**3. Deploy fungsinya** dari folder proyek (sekali, dan lagi setiap kode fungsinya berubah):

```bash
brew install supabase/tap/supabase
```

```bash
supabase login
```

```bash
supabase link --project-ref <kode-proyek>
```

```bash
supabase functions deploy
```

**4. (Dianjurkan) Notification URL** di DOKU Back Office tiap franchise:
`https://<kode-proyek>.supabase.co/functions/v1/doku-notify` (alamatnya sama untuk semua franchise dan ditampilkan di
halaman setup). Tanpa ini pembayaran tetap terdeteksi selama tablet masih menampilkan QR-nya; dengan ini, pembayaran
yang masuk setelah tamu meninggalkan layar pun tetap tercatat.

**5. Nyalakan** di dashboard franchise → **Pengaturan → Cara bayar → QRIS → Otomatis (DOKU)**, isi kuncinya, lalu Simpan.

Yang perlu diketahui:

- Tablet butuh internet untuk QRIS otomatis. Tunai dan QRIS manual tetap bisa jadi cadangan.
- Kalau tamu membayar tetapi sesinya tidak selesai (misalnya tablet mati), pembayarannya muncul di dashboard →
  **Kasir QRIS** sebagai **Lunas tanpa sesi**. Pengembalian uang dilakukan dari DOKU Back Office.
- Kolom **Status** di **Riwayat Sesi** membaca status pembayaran yang dilaporkan DOKU (Berhasil, Menunggu, Gagal). Sesi
  baru dimulai setelah DOKU menyatakan lunas, jadi sesi QRIS di sana biasanya **Berhasil**; kode QR yang masih
  menunggu, tidak dibayar, atau gagal tidak pernah menjadi sesi dan tercatat di **Kasir QRIS**. Tunai, voucher, dan
  QRIS manual selalu **Berhasil**.
- Kalau QR gagal dibuat, pesan dari DOKU tersimpan di kolom `detail` tabel `payments` dan di log fungsi
  (Supabase → Edge Functions → `qris-create` → Logs).

### Titip saldo: QRIS franchise lewat akun DOKU platform

Untuk franchise yang tidak punya QRIS sendiri dan tidak mau menerima tunai. Tamunya membayar ke akun DOKU milik pemilik
platform (kunci `DOKU_*` di Secrets fungsi), uangnya dicatat sebagai saldo franchise itu, lalu dicairkan dengan transfer
manual.

- **Menyalakan**: superadmin → **Franchise → Atur → Titip saldo → QRIS lewat akun platform**. Di dashboard franchise itu
  lalu muncul menu **Dompet**, dan bagian Akun DOKU di Pengaturan berganti menjadi keterangan "QRIS lewat platform".
  Franchise tetap perlu menyalakan **Pengaturan → Cara bayar → QRIS → Otomatis (DOKU)**.
- **Potongan**: tiap QRIS yang lunas dipotong biaya DOKU (bawaan Rp500) dan biaya platform (bawaan Rp200); sisanya masuk
  ke dompet. Kedua biaya dan jarak antar pencairan (bawaan 7 hari) diatur di **Pengaturan platform → Titip saldo** dan
  sama untuk semua franchise. Biayanya dicatat pada tiap pembayaran saat QR dibuat, jadi mengubah tarif tidak mengubah
  transaksi yang sudah ada.
- **Dompet** (franchise): saldo tersedia, yang sedang diajukan, yang sudah dicairkan, daftar QRIS masuk dengan
  potongannya, dan riwayat pencairan. Franchise mengisi rekening tujuan, lalu mengajukan pencairan: satu pengajuan pada
  satu waktu, paling sering sekali tiap jarak yang diatur, tidak melebihi saldo.
- **Pencairan** (superadmin): pengajuan yang menunggu, lengkap dengan rekening dan tombol salin. Setelah mentransfer dari
  rekeningmu, tekan **Tandai sudah ditransfer** (boleh dengan catatan, misalnya nomor referensi). **Tolak** mengembalikan
  jumlahnya ke saldo franchise. Halaman ini juga menampilkan saldo tiap franchise, uang franchise yang masih ada padamu,
  dan biaya platform yang terkumpul.
- **Akun keuangan**: supaya orang yang mengurus pencairan tidak perlu akses superadmin. Superadmin membuatnya di
  **Pencairan → Akun keuangan** (email, lalu password sementara dan tautannya lewat **Salin semua**). Akun itu masuk di
  `https://<alamat-aplikasi>/#finance` dan hanya mendapat halaman Pencairan: pengajuan, rekening tujuan, saldo tiap
  franchise, dan tombol tandai/tolak. Ia tidak bisa membuka dashboard, transaksi, foto, atau pengaturan franchise mana
  pun, tidak bisa mengubah biaya, dan tidak bisa menyalakan titip saldo; database menolaknya, bukan hanya menunya yang
  disembunyikan. Satu email satu peran: superadmin, admin franchise, atau keuangan. Riwayat pencairan mencatat siapa
  yang menandai tiap pengajuan (kolom **Oleh**).
- Tunai, voucher, dan QRIS manual tidak lewat dompet. Mematikan titip saldo menghentikan QRIS baru masuk ke dompet; saldo
  yang sudah ada tetap bisa dicairkan.
- Aplikasi ini hanya mencatat: uangnya sendiri berpindah lewat DOKU (ke rekeningmu) dan lewat transfer manualmu (ke
  franchise). Pastikan perjanjianmu dengan DOKU mengizinkan menerima pembayaran untuk usaha lain.

## Yang belum ada

- Pengembalian uang QRIS dari dashboard — saat ini dilakukan di DOKU Back Office.
- Tagihan langganan otomatis — saat ini pembayaran langganan franchise dicatat manual oleh superadmin.
- Harga berbeda per tablet dalam satu franchise — saat ini satu set harga untuk semua tablet sebuah franchise.
- Stiker dan tulisan dari tamu di langkah edit — saat ini tamu bisa mengganti gaya foto dan foto ulang.
- Deteksi kertas habis — printer tidak dilaporkan statusnya; siapkan kertas cadangan dan cek berkala.
- Mencetak slip voucher di printer struk — saat ini kodenya disalin atau diunduh sebagai CSV dari dashboard.
- Voucher saat tablet sedang tanpa internet.
- Voucher yang bisa dipakai berkali-kali (satu kode untuk banyak tamu).
- Menu Event, dan pencairan dana: uang QRIS dan tunai langsung masuk ke tiap franchise, jadi dashboard hanya
  mencatatnya.

## Privasi

Foto mentah tamu hanya disimpan di tablet (untuk cetak ulang); jumlah sesi yang disimpan bisa diatur, dan penyimpanan
bisa dimatikan sepenuhnya di tab **Riwayat**. Ke Supabase yang dikirim hanya catatan transaksi (waktu, frame, harga,
cara bayar, kode voucher) dan status tablet.

Hasil foto berframe setiap sesi, satu foto kecil untuk daftar transaksi, dan (kalau harganya termasuk video) boomerang
serta video slideshow dikirim ke Cloudflare R2 dan dihapus otomatis setelah 3 hari. Selama itu fotonya bisa dibuka oleh
tamu pemegang kode QR-nya, admin franchise itu, dan superadmin.

Untuk franchise yang **Edit foto AI**-nya dinyalakan, foto tiap jepretan tanpa frame juga dikirim ke R2 (ikut terhapus
setelah 3 hari).
Satu foto baru dikirim ke layanan AI Google saat tamu sendiri menekan **Buat versi AI** di halaman unduh, dan halaman
itu mengatakannya di dekat tombolnya. Pada pemakaian API berbayar, Google menyatakan tidak memakai kiriman untuk
melatih modelnya, tetapi menyimpan log sementara untuk mendeteksi penyalahgunaan; semua hasilnya diberi watermark tak
terlihat (SynthID).

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
| `supabase/functions/` | Edge Functions untuk QRIS otomatis lewat DOKU. |
| `tests/` | Tes untuk pengolahan gambar, ESC/POS, voucher, pembukuan, dan ringkasan dashboard. |
