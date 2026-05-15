# 🌳 Family Tree – Ứng dụng Cây Gia Đình

Ứng dụng quản lý và hiển thị cây gia đình hoàn toàn chạy trên trình duyệt, không cần backend.

---

## 📁 Cấu trúc thư mục

```
family-tree/
├── index.html        # Giao diện chính (HTML + layout)
├── style.css         # Toàn bộ CSS (variables, components, responsive)
├── app.js            # Logic app (DataStore, TreeRenderer, UI, App)
├── sample-data.json  # Dữ liệu mẫu (có thể import)
└── README.md         # Tài liệu này
```

---

## 🚀 Hướng dẫn chạy

### Cách 1 – Mở trực tiếp (đơn giản nhất)
1. Tải về toàn bộ 3 file: `index.html`, `style.css`, `app.js`
2. Mở `index.html` bằng bất kỳ trình duyệt nào (Chrome, Firefox, Edge, Safari)
3. Ứng dụng tự động tải dữ liệu mẫu khi lần đầu mở

> ⚠️ Nếu ảnh không hiển thị do CORS, hãy dùng cách 2 bên dưới.

### Cách 2 – Dùng local server (khuyến nghị)
```bash
# Python 3
python -m http.server 8080

# Node.js
npx serve .

# VS Code: Cài extension "Live Server" rồi click "Go Live"
```
Mở trình duyệt tại: `http://localhost:8080`

---

## 📌 Tính năng đầy đủ

| Tính năng | Phím tắt |
|-----------|----------|
| Undo | `Ctrl+Z` |
| Redo | `Ctrl+Y` / `Ctrl+Shift+Z` |
| Đóng modal/panel | `Escape` |
| Zoom cây | Cuộn chuột |
| Kéo cây | Click-drag trên vùng trống |

### Quản lý thành viên
- ✅ Thêm / Sửa / Xóa thành viên
- ✅ Upload ảnh (base64) hoặc nhập URL ảnh
- ✅ Custom fields động (thêm trường bất kỳ)
- ✅ Tìm kiếm tên theo thời gian thực
- ✅ Lọc theo giới tính và thế hệ

### Quan hệ
- ✅ Cha/Mẹ → Con
- ✅ Vợ/Chồng
- ✅ Anh/Chị/Em
- ✅ Ngăn chặn quan hệ trùng lặp

### Hiển thị cây
- ✅ Layout dọc / ngang
- ✅ Zoom & Pan mượt mà
- ✅ Nút căn giữa cây
- ✅ Node hiển thị ảnh + tên + năm sinh + badge giới tính
- ✅ Đường nối SVG curved (khác màu theo loại quan hệ)
- ✅ Click node → Panel chi tiết trượt ra

### Nâng cao
- ✅ Undo/Redo (tối đa 50 thao tác)
- ✅ Dark mode
- ✅ Import/Export JSON
- ✅ Export PNG (dùng html2canvas)
- ✅ Timeline gia đình (theo năm sinh/mất)
- ✅ Thống kê: tổng thành viên, nam/nữ, số thế hệ
- ✅ Auto-save localStorage
- ✅ Responsive mobile

---

## 🏗️ Giải thích kiến trúc & hàm chính

### `DataStore` (Singleton)
Quản lý toàn bộ dữ liệu và logic nghiệp vụ.

| Hàm | Mô tả |
|-----|-------|
| `addPerson(data)` | Tạo ID tự động, lưu person, snapshot undo |
| `updatePerson(id, data)` | Merge data vào person hiện có |
| `deletePerson(id)` | Xóa person + tất cả relation liên quan |
| `addRelation(pA, pB, type)` | Kiểm tra trùng lặp trước khi thêm |
| `computeGenerations()` | BFS từ root → trả về Map<id, gen> |
| `exportJSON()` | Serialize state thành JSON string |
| `importJSON(str)` | Parse + validate + snapshot |
| `undo() / redo()` | Pop từ undoStack/redoStack, rerender |

### `TreeRenderer` (Singleton)
Tính toán vị trí và render DOM/SVG.

| Hàm | Mô tả |
|-----|-------|
| `calculateLayout(persons, relations)` | Nhóm theo generation, phân bố x/y |
| `renderNodes(persons, positions)` | Tạo/update DOM `.tree-node` |
| `renderEdges(relations, positions)` | Vẽ SVG path curved cho từng relation |
| `fitToView(container)` | Tính scale + pan để fit toàn bộ tree |
| `initDrag(container)` | Mouse + touch drag, wheel zoom |
| `zoom(delta)` | Thay đổi scale, cập nhật transform |

### `UI` (Singleton)
Xử lý modal, panel, sidebar.

| Hàm | Mô tả |
|-----|-------|
| `openPersonModal(id?)` | Mở modal thêm/sửa, fill form nếu sửa |
| `savePersonForm()` | Validate + gọi DataStore.add/update |
| `openDetailPanel(id)` | Build HTML chi tiết + slide panel ra |
| `renderSidebar()` | Lọc + render danh sách member card |
| `openTimeline()` | Sort events theo năm, render timeline |
| `openStats()` | Tính thống kê, render chart text |

### `App` (Bootstrap)
| Hàm | Mô tả |
|-----|-------|
| `init()` | Load data, init drag, render, bind events |
| `render()` | Gọi lại toàn bộ: layout → nodes → edges → sidebar → stats |

---

## 💾 Cấu trúc dữ liệu JSON

```json
{
  "meta": { "title": "Tên gia đình" },
  "persons": {
    "id_unique": {
      "id": "id_unique",
      "name": "Nguyễn Văn A",
      "gender": "male",          // "male" | "female" | "other"
      "birthYear": 1980,         // number | null
      "deathYear": null,         // number | null
      "photo": "url_hoặc_base64",
      "phone": "0901 234 567",
      "address": "Hà Nội",
      "note": "Ghi chú",
      "customFields": [
        { "key": "Nghề nghiệp", "value": "Kỹ sư" }
      ]
    }
  },
  "relations": [
    {
      "id": "r01",
      "personA": "id_cha",
      "personB": "id_con",
      "type": "parent"           // "parent" | "spouse" | "sibling"
    }
  ]
}
```

**Lưu ý quan hệ:**
- `parent`: personA là cha/mẹ của personB
- `spouse`: đôi xứng nhau
- `sibling`: đôi xứng nhau

---

## 🎨 Tùy chỉnh giao diện

Chỉnh CSS variables trong `:root` của `style.css`:

```css
:root {
  --color-primary: #8b6914;   /* Màu chủ đạo */
  --sidebar-w: 280px;          /* Độ rộng sidebar */
  --font-heading: 'Playfair Display', ...;
  --font-body: 'DM Sans', ...;
}
```

---

## 🔧 Mở rộng

- **Thêm loại quan hệ mới:** Thêm option vào `<select id="rel-type">` trong HTML và xử lý trong `renderEdges()` (màu/dash)
- **Thêm field mặc định:** Thêm input vào form trong HTML, cập nhật `getPersonFormData()` và `fillPersonForm()`  
- **Thay đổi thuật toán layout:** Sửa hàm `calculateLayout()` trong `TreeRenderer`

---

## 📦 Dependencies (CDN, không cần cài)

| Thư viện | Phiên bản | Dùng cho |
|----------|-----------|----------|
| Font Awesome | 6.5.1 | Icons |
| html2canvas | 1.4.1 | Export PNG |
| Google Fonts | – | Playfair Display, DM Sans |

---

*Được tạo với ❤️ – Chạy 100% trên trình duyệt, không backend, không framework.*
