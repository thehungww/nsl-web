"""Browser acceptance using synthetic images and real isolated SQLite storage."""
import io,json,zipfile
from pathlib import Path
from PIL import Image
from playwright.sync_api import sync_playwright,expect
root=Path(__file__).resolve().parents[1]
checks=[]
def passed(name):checks.append(name);print(name,flush=True)
def photo():
 data=io.BytesIO();Image.new('RGB',(32,24),'white').save(data,'PNG')
 return {'name':'private-name.jpg','mimeType':'image/png','buffer':data.getvalue()}
with sync_playwright() as p:
 browser=p.chromium.launch(channel='msedge',headless=True)
 context=browser.new_context(base_url='http://127.0.0.1:8788',viewport={'width':1366,'height':768},reduced_motion='reduce',accept_downloads=True)
 owner=context.new_page();errors=[];owner.on('pageerror',lambda e:errors.append(str(e)))
 owner.goto('/');expect(owner.locator('#collection-dialog')).to_be_visible()
 expect(owner.locator('#collection-own')).not_to_be_checked();expect(owner.locator('#collection-agree')).not_to_be_checked()
 expect(owner.locator('#collection-accept')).to_be_disabled();expect(owner.locator('#collection-dialog')).not_to_contain_text('Google Drive')
 owner.locator('#close-collection').click();passed('Notice opens on entry with no external setup and no prechecked consent')
 owner.locator('#admin-button').click()
 if owner.locator('#setup-token-row').is_visible():
  owner.locator('#setup-token').fill('test-owner-bootstrap');owner.locator('#admin-password').fill('test-password-123');owner.locator('#admin-confirm').fill('test-password-123')
  owner.locator('#admin-form button[type=submit]').click();expect(owner.locator('#admin-feedback')).to_contain_text('Đã tạo')
 owner.locator('#admin-password').fill('test-password-123');owner.locator('#admin-form button[type=submit]').click();expect(owner.locator('#admin-button')).to_have_text('Đăng xuất admin')
 owner.locator('#collection-library-button').click();expect(owner.locator('#collection-library-stats')).to_contain_text('0 ảnh')
 expect(owner.locator('.library-empty')).to_be_visible();owner.locator('#close-collection-library').click();passed('Admin-only library starts empty')
 guest_context=browser.new_context(base_url='http://127.0.0.1:8788',viewport={'width':1366,'height':768},reduced_motion='reduce',accept_downloads=True)
 guest=guest_context.new_page();guest.on('pageerror',lambda e:errors.append(str(e)));guest.goto('/')
 expect(guest.locator('#collection-dialog')).to_be_visible();guest.locator('#collection-decline').click()
 guest.locator('#image-files').set_input_files(photo());expect(guest.locator('#gallery button')).to_have_count(1)
 expect(guest.locator('#collection-library-button')).not_to_be_visible();passed('Declined image remains usable and guest cannot open admin library')
 owner.locator('#collection-library-button').click();expect(owner.locator('#collection-library-stats')).to_contain_text('0 ảnh');owner.locator('#close-collection-library').click();passed('Unconsented photograph is absent from persistent storage')
 guest.locator('#collection-button').click();guest.locator('#collection-own').check();guest.locator('#collection-agree').check()
 guest.locator('#collection-accept').click();expect(guest.locator('#collection-receipt-panel')).to_be_visible()
 code=guest.locator('#collection-receipt').inner_text();assert len(code)==48;guest.locator('#close-collection').click()
 guest.locator('#image-files').set_input_files([photo(),photo()]);expect(guest.locator('#gallery button')).to_have_count(3)
 expect(guest.locator('#collection-photo-status')).to_contain_text('2 ảnh đã lưu');passed('Only images added after consent enter web storage')
 owner.locator('#collection-library-button').click();expect(owner.locator('.library-card')).to_have_count(2)
 expect(owner.locator('.library-card img').first).to_have_attribute('src',__import__('re').compile('^blob:'))
 owner.locator('.library-photo').first.click();expect(owner.locator('#collection-preview-dialog')).to_be_visible()
 expect(owner.locator('#collection-preview')).to_have_attribute('src',__import__('re').compile('^blob:'));owner.locator('#close-collection-preview').click();passed('Admin sees thumbnails and opens a large private image')
 with owner.expect_download() as info:owner.locator('.library-download').first.click()
 with Image.open(info.value.path()) as image:assert image.format=='JPEG' and image.size==(32,24)
 passed('Individual download is a valid JPEG')
 with owner.expect_download() as info:owner.locator('#collection-zip').click()
 with zipfile.ZipFile(info.value.path()) as archive:
  names=archive.namelist();assert len(names)==3 and 'thong-tin-anh.json' in names
  manifest=json.loads(archive.read('thong-tin-anh.json'));assert len(manifest['images'])==2
  assert archive.testzip() is None
  for name in names:
   if name.endswith('.jpg'):
    with Image.open(io.BytesIO(archive.read(name))) as image:assert image.format=='JPEG'
 passed('Page ZIP contains valid photographs and retention metadata')
 owner.set_viewport_size({'width':390,'height':844})
 assert owner.locator('#collection-library-dialog').evaluate('(e)=>e.scrollWidth<=e.clientWidth+1')
 assert owner.evaluate('document.documentElement.scrollWidth<=innerWidth')
 owner.screenshot(path=str(root/'runtime/library-mobile.png'),full_page=True);passed('Private library fits mobile without horizontal overflow')
 owner.set_viewport_size({'width':1366,'height':768});owner.screenshot(path=str(root/'runtime/library-desktop.png'),full_page=True)
 owner.locator('.library-choice input').first.check();owner.once('dialog',lambda d:d.accept());owner.locator('#collection-delete-selected').click()
 expect(owner.locator('.library-card')).to_have_count(1);passed('Admin deletes selected image and keeps the other one')
 owner.locator('#close-collection-library').click()
 other_context=browser.new_context(base_url='http://127.0.0.1:8788',viewport={'width':390,'height':844},reduced_motion='reduce')
 other=other_context.new_page();other.on('pageerror',lambda e:errors.append(str(e)));other.goto('/')
 expect(other.locator('#collection-dialog')).to_be_visible();other.locator('.collection-withdrawal summary').click();other.locator('#collection-code').fill(code)
 other.locator('#collection-withdraw').click();expect(other.locator('#collection-feedback')).to_contain_text('xác nhận xóa ảnh')
 passed('Withdrawal code deletes remaining photos from another browser session')
 owner.locator('#collection-library-button').click();expect(owner.locator('#collection-library-stats')).to_contain_text('0 ảnh');passed('Withdrawn photographs immediately disappear from admin library')
 owner.evaluate("() => document.getElementById('admin-button').click()")
 expect(owner.locator('#collection-library-dialog')).not_to_be_visible();expect(owner.locator('#collection-library-button')).not_to_be_visible();expect(owner.locator('.library-card')).to_have_count(0)
 passed('Logout closes private gallery and removes image previews')
 assert not errors,errors;passed('No JavaScript errors')
 browser.close()
(root/'runtime/collection-browser-result.json').write_text(json.dumps({'passed':len(checks),'checks':checks,'storage':'real isolated SQLite','images':'synthetic'},ensure_ascii=False,indent=2),encoding='utf-8')
