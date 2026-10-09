import { fromBase64, UserError } from './security.js';
export const VI_NAMES = {
  blackhead: 'Mụn đầu đen', blackheads: 'Mụn đầu đen', whitehead: 'Mụn đầu trắng', whiteheads: 'Mụn đầu trắng',
  papule: 'Mụn sẩn', papules: 'Mụn sẩn', pustule: 'Mụn mủ', pustules: 'Mụn mủ', nodule: 'Mụn nốt', nodules: 'Mụn nốt',
  cyst: 'Mụn nang', cysts: 'Mụn nang', acne: 'Mụn trứng cá', 'mụn trứng cá': 'Mụn trứng cá'
};
for (const value of Object.values(VI_NAMES)) VI_NAMES[value.toLowerCase()] = value;
const normalized = value => value.trim().toLowerCase().replace(/[_-]/g, ' ');
export function jpegInfo(data) {
  if (typeof data !== 'string' || data.length > 1200000 || !/^[A-Za-z0-9+/]*={0,2}$/.test(data)) throw new UserError('Ảnh quá lớn hoặc không hợp lệ. Hãy thêm lại ảnh.');
  const bytes = fromBase64(data);
  if (bytes[0] !== 255 || bytes[1] !== 216) throw new UserError('Ảnh cần được chuyển thành JPEG trước khi tải lên.');
  let pos = 2;
  while (pos + 8 < bytes.length) {
    if (bytes[pos++] !== 255) throw new UserError('Ảnh JPEG bị hỏng.');
    while (bytes[pos] === 255) pos++;
    const marker = bytes[pos++];
    if (marker === 217 || marker === 218) break;
    if (marker === 1 || marker >= 208 && marker <= 215) continue;
    const length = bytes[pos] * 256 + bytes[pos + 1];
    if (length < 2 || pos + length > bytes.length) break;
    if ([192, 193, 194, 195, 197, 198, 199, 201, 202, 203, 205, 206, 207].includes(marker)) {
      const height = bytes[pos + 3] * 256 + bytes[pos + 4], width = bytes[pos + 5] * 256 + bytes[pos + 6];
      if (!width || !height || width > 1600 || height > 1600) throw new UserError('Ảnh tối đa 1600 pixel mỗi chiều.');
      return { width, height, bytes };
    }
    pos += length;
  }
  throw new UserError('Không đọc được kích thước ảnh JPEG.');
}
export function parsePrediction(data, photo, confidence, seconds) {
  try {
    const meta = data.metadata, frame = data.images[0], names = meta.classNames;
    if ((meta.task || 'detect') !== 'detect' || !names || Object.keys(names).length === 0 || Object.keys(names).length > 100)
      throw new Error();
    if (Object.values(names).some(n => typeof n !== 'string' || !VI_NAMES[normalized(n)])) throw new UserError('Endpoint không phải mô hình nhận diện mụn. Kiểm tra tên lớp trên Ultralytics.');
    if (data.images.length !== 1 || frame.shape[0] !== photo.height || frame.shape[1] !== photo.width || !Array.isArray(frame.results) || frame.results.length > 2000) throw new Error();
    const detections = [];
    for (const item of frame.results) {
      const score = item.confidence, id = item.class, name = names[id];
      if (!Number.isInteger(id) || id < 0 || typeof name !== 'string' || item.name !== name || !Number.isFinite(score) || score < 0 || score > 1) throw new Error();
      const coords = ['x1', 'y1', 'x2', 'y2'].map(k => item.box[k]);
      if (!coords.every(Number.isFinite)) throw new Error();
      if (score < confidence) continue;
      const [x1,y1,x2,y2] = coords.map((v,i) => Math.max(0,Math.min(v,(i % 2 === 0 ? photo.width : photo.height) - 1)));
      if (x2 > x1 && y2 > y1) detections.push({ class_id: id, name: VI_NAMES[normalized(name)], original_name: name, confidence: score, box: [x1,y1,x2,y2] });
    }
    detections.sort((a,b) => b.confidence - a.confidence);
    const counts = new Map(); for (const d of detections) counts.set(d.name, (counts.get(d.name) || 0) + 1);
    return { detections, types: [...counts].map(([name,count]) => ({name,count})), seconds, confidence };
  } catch (error) { if (error instanceof UserError) throw error; throw new UserError('Kết quả Ultralytics không đúng cấu trúc detect được hỗ trợ.'); }
}
export function invalidate(session) {
  for (const photo of session.photos) { delete photo.result; photo.error = ''; photo.revision++; }
  session.chats.image = []; session.image_context = null;
}
function photoContext(photo) {
  return { nguong_tin_cay: photo.result.confidence, tong_so_vung: photo.result.detections.length,
    cac_loai_phat_hien: photo.result.types.map(t => ({ten: t.name, so_luong: t.count})) };
}
export function imageContext(session, scope, id, confidence) {
  if (!['one','all'].includes(scope)) throw new UserError('Phạm vi ảnh không hợp lệ.');
  const photos = scope === 'all' ? session.photos : session.photos.filter(p => p.id === id);
  if (photos.some(p => p.result && p.result.confidence !== confidence)) throw new UserError('Ngưỡng đã đổi. Quét lại ảnh trước khi phân tích.');
  if (!photos.some(p => p.result)) throw new UserError('Quét ảnh trước khi hỏi theo ảnh.');
  if (scope === 'one') return { pham_vi: 'mot_anh', chi_so_anh: session.photos.indexOf(photos[0]) + 1, so_anh: session.photos.length, ...photoContext(photos[0]) };
  return { pham_vi: 'tat_ca_anh', so_anh: photos.length, so_anh_da_quet: photos.filter(p => p.result).length,
    cac_anh: photos.map((p,i) => ({chi_so_anh: i+1, trang_thai: p.result ? 'da_quet' : p.error ? 'loi' : 'chua_quet', ...(p.result ? photoContext(p) : {})})),
    luu_y: 'Không cộng vùng giữa các góc mặt vì có thể là cùng một tổn thương.' };
}
const escapeXml = value => String(value).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&apos;'}[c]));
export function annotatedSvg(photo, data) {
  const colors = ['#155e75','#7c3aed','#0369a1','#be185d','#b45309','#047857'];
  const font = Math.max(12,Math.round(photo.width / 60));
  const boxes = photo.result.detections.map((d,i) => {
    const [x1,y1,x2,y2] = d.box, color = colors[d.class_id % colors.length];
    return `<rect x="${x1}" y="${y1}" width="${x2-x1}" height="${y2-y1}" fill="none" stroke="${color}" stroke-width="2"/><text x="${x1}" y="${Math.max(font,y1-4)}" fill="${color}" stroke="white" stroke-width=".5" paint-order="stroke" font-size="${font}">${escapeXml(`${i+1}. ${d.original_name} ${(d.confidence*100).toFixed(0)}%`)}</text>`;
  }).join('');
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${photo.width}" height="${photo.height}" viewBox="0 0 ${photo.width} ${photo.height}"><image width="100%" height="100%" href="data:image/jpeg;base64,${data}"/>${boxes}</svg>`;
}
