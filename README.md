# Hiên Nhà của bạn

Đây là blog Static Only độc lập: cấu hình, nội dung và ảnh thuộc repository của bạn. Core được ghim bằng bốn package tarball có phiên bản/hash; không cần registry riêng hay backend chung. Không sửa source Astro để đổi tên, màu, banner hoặc nội dung.

## Bắt đầu

1. Tạo repository của bạn từ template đã phát hành. Chọn tên viết thường, chữ/số và dấu gạch nối (ví dụ my-home). Chọn tài khoản và repository do bạn sở hữu.
2. Trên máy có Node 26.13.0/npm 11.20.0 và Git, chạy npm ci rồi npm run studio; mở http://127.0.0.1:4447. Hoặc chọn Code → Codespaces → tạo workspace trên main: descriptor sẽ cài dependencies và mở Bàn viết tự động, không cần gõ lệnh cho luồng này. Giữ cổng 4447 **Private**, kiểm tra quota tài khoản và dừng Codespace khi xong; GitHub xác thực quyền vào workspace. Không mở Bàn viết trên cổng public. Chọn mẫu, chỉnh profile/theme/banner/menu và lưu địa chỉ hosting bằng form; không sửa source Astro.
3. GitHub → Settings → Pages → Source: GitHub Actions. Chưa bật publication khi chưa kiểm tra cấu hình/preview.
4. hosting.config.json giữ origin và base riêng. Với owner/my-home, địa chỉ là https://owner.github.io/my-home/; với owner/owner.github.io, base là /. Không nhập token hay key vào các file.
5. Sau khi kiểm tra, dùng lựa chọn xuất bản riêng trong Bàn viết, rồi Kiểm tra trạng thái Git → tạo commit → push lên origin/main. Workspace cần có credentials/quyền GitHub và main theo dõi origin/main; không nhập token vào browser. Workflow kiểm tra tên repo/địa chỉ trước khi deploy; mở GitHub Actions để xem kết quả thật. PR chỉ build, không deploy. Publication mặc định false; tắt publication không gỡ website đang host.

Các lệnh dành cho developer: npm ci; npm run verify; npm run dev; npm run preflight. Dùng Node/npm theo .nvmrc/package.json. Template xuất ra đã có vendor và lockfile; folder source templates/static trong monorepo cần được export trước.

## Dữ liệu và ảnh

site.config.json là presentation v3, hosting.config.json là địa chỉ hosting v1; content/posts.json là dữ liệu v1. Source ảnh nằm tại content/assets/<logical-path>, ví dụ content/assets/media/photo.png. Chỉ ảnh raster đúng đuôi/chữ ký và được public projection hoặc presentation tham chiếu mới được copy vào output. Không dùng SVG/HTML, symlink, URL ngoài hay ảnh draft/ONLY_ME trong public banner/avatar. Giới hạn kỹ thuật hiện tại: 5 MiB/ảnh, 20 MiB ảnh được xuất mỗi build. Kiểm tra chữ ký không phải bộ giải mã/quét nội dung ảnh; không tự xóa EXIF hoặc bảo đảm ảnh không có dữ liệu nhạy cảm.

ONLY_ME và bản nháp không được xuất ra website. **Trong repo GitHub công khai, nội dung/ảnh source và lịch sử Git vẫn có thể được đọc: ONLY_ME chỉ ẩn khỏi web, không giữ bí mật dữ liệu.** Không lưu secrets hoặc thông tin cần bảo mật vào repository. Không có private comments, OAuth hay backend trong Static Only. public/ không phải nguồn publish; Astro chỉ copy thư mục generated allowlist.

Core packages giữ MIT LICENSE trong vendor; registry dependencies giữ license riêng. core.lock.json ghi phiên bản/hash/source. Build/dev/Studio kiểm tra archive SHA-512, lock, version cài đặt và contracts trước khi chạy. Dependabot chuẩn bị PR cho registry dependencies/Actions; PR chạy verify và không deploy. Không auto-merge/auto-update website. Core hiện là tarball riêng, **chưa có kênh nhận release Core thành update PR tự động**. Trước update Core cần review pin/compatibility và bảo toàn config/content. Actual hosted/new-account acceptance và release receipt vẫn phải được chứng minh; local/container/WebKit không thay thế các gate đó.

## Bàn viết và bản xem trước

Ba mẫu Hiên giấy/Vườn xanh/Đêm yên giữ nguyên danh tính, menu và nội dung khi đổi theme. Bạn có thể chỉnh màu, font, banner, ảnh, menu và module rồi tạo bản xem trước Astro thật theo chiều rộng điện thoại/tablet/máy tính. Dùng lối tắt Xem trước trên mobile. Bản xem trước không sửa cấu hình đã lưu và không phải website đã deploy. Lưu giao diện, lưu địa chỉ, Git commit/push và xuất bản là các bước khác nhau.

Ngôn ngữ Bàn viết (VI/EN) chỉ đổi UI/help/cảnh báo, không dịch hoặc ghi đè chữ của bạn và độc lập với Ngôn ngữ website. Ba preset được kiểm tra các cặp chữ/link/nền; khi chỉnh màu tùy ý, Bàn viết báo cặp dưới 4.5:1. Đây không phải audit accessibility đầy đủ. Bản xem trước riêng chặn script nên không chạy search tương tác.

## Tìm bài và theo dõi RSS

Website xuất search.json, rss.xml và sitemap.xml từ đúng projection bài PUBLIC đã xuất bản. ONLY_ME/nháp và ảnh riêng không đi vào các index; tắt module Posts cho kết quả/feed bài rỗng. Search chạy tại website, không gửi dữ liệu tới search service hay dùng credentials. Tiêu đề/nội dung vẫn là chữ thuần; lỗi index có thể thử lại. Content v1 chưa có ngày đăng nên RSS/sitemap không tự bịa ngày. Đường dẫn hoạt động ở root hoặc project base.

## English quick start

Use the released template in your own repository. Local prerequisites are Node 26.13.0, npm 11.20.0 and Git; run npm ci, then npm run studio and open http://127.0.0.1:4447. The optional Codespaces descriptor installs/starts the private desk automatically: check quota, keep port 4447 Private and stop the Codespace when finished. Actual provider onboarding must still be verified for the release target; container tests are separate evidence.

Choose English in Studio language. Authored text and website locale remain independent. Save design/content/address separately, explicitly choose visibility and acknowledge that ONLY_ME/drafts/source images remain readable in a public Git repository/history. Preview is private, not a deployment. Export contains saved JSON references only; back up source images separately. Configure your own Pages source as GitHub Actions, explicitly allow publication, then commit/push with workspace credentials. Open Actions to verify its real result. Never enter a PAT in the browser. Core is pinned private tarballs with no automatic Core release-update channel; dependency PR checks do not auto-upgrade your website.

## Bài viết và Git

Dùng Những trang viết để tạo/sửa/xóa bài chữ thuần, chọn rõ PUBLIC/ONLY_ME, đặt trạng thái sẵn sàng hiển thị hoặc nháp và thêm tối đa 4 ảnh với mô tả. Không thực thi Markdown/HTML. Xem riêng bài đang chỉnh có thể xem cả ONLY_ME/nháp trong workspace; không làm chúng xuất hiện trong public build. Lưu bài ONLY_ME/nháp yêu cầu xác nhận source/lịch sử Git. Xóa bài cần xác nhận, không xóa ảnh source hay lịch sử đã commit. ID mới được tạo tự động; template từ chối tên đường dẫn thiết bị Windows để chạy được trên cả Windows/Linux.

Xuất JSON đã lưu gồm tham chiếu ảnh, không gồm byte ảnh và không phải backup đầy đủ. Giữ file xuất riêng vì có thể chứa ONLY_ME/nháp. Nhập tối đa 2 triệu byte, dùng ContentDocument v1 đúng siteId; chỉ chọn mảng 5 trường cũ khi chủ động di chuyển dữ liệu legacy. Nhập được kiểm tra trước, xác nhận thay bản chỉnh sửa, rồi bấm Lưu riêng. File không hợp lệ/phiên bản lạ/ảnh thiếu không ghi đè source.

Git chỉ nhận bốn file cấu hình/nội dung và raster trong content/assets, ở đúng repo root/main/origin/main và remote khớp địa chỉ đã lưu. File staged/dirty/untracked ngoài allowlist, lịch sử không phù hợp hoặc remote thay đổi phải được xử lý thủ công. Không tự reset/pull/merge/force push. Commit thất bại có thể để lại file hợp lệ đã stage; push lỗi giữ commit cục bộ và có thể cần kiểm tra remote trước thử lại. Credentials, Git author và mọi xung đột thuộc workspace của bạn. Các commit nội dung này tắt hooks/signing theo từng lệnh, không sửa Git config. Push được xác nhận không đồng nghĩa Actions/Pages đã thành công; Bàn viết cung cấp liên kết Actions và ghi rõ kết quả deploy chưa xác minh.

Upload ảnh trong Bàn viết giải mã dưới giới hạn 40 triệu pixel, xoay đúng chiều, resize tối đa 2400×2400 và chuyển WebP không giữ metadata đầu vào. Ảnh được lưu với tên hash bất biến trong source; chỉ ảnh được tham chiếu public mới vào website. Ảnh tự thêm bằng file vẫn theo kiểm tra chữ ký/giới hạn ở trên. Xem lại nội dung ảnh trước khi dùng.

Lưu dùng revision, khóa workspace, backup byte gốc và thay một file cố định. Xung đột giữ bản chỉnh sửa, không ghi đè. Nút Tải bản đã lưu yêu cầu xác nhận trước khi bỏ thay đổi. Hoàn tác/làm lại giữ 20 bước trong bộ nhớ; đóng tab không phải lưu. Backup/private preview nằm dưới .hien-nha, được ignore và không được deploy. Nếu crash để lại write.lock, dừng mọi Studio trước khi kiểm tra trạng thái và chỉ bỏ khóa cũ; không xóa khóa đang hoạt động. Lock không bảo vệ khỏi tiến trình OS khác cố tình sửa file. Không có bảo đảm backup/restore P5 trong công cụ này.
