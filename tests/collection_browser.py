"""Opt-in flow against the isolated server, with synthetic photographs/Drive."""
import io
import json
from pathlib import Path
from PIL import Image
from playwright.sync_api import sync_playwright, expect

root=Path(__file__).resolve().parents[1]
checks=[]
def passed(name):
    checks.append(name)
    print(name,flush=True)
def photo():
    data=io.BytesIO();Image.new('RGB',(32,24),'white').save(data,'PNG')
    return {'name':'synthetic.jpg','mimeType':'image/png','buffer':data.getvalue()}
with sync_playwright() as p:
    browser=p.chromium.launch(channel='msedge',headless=True)
    context=browser.new_context(base_url='http://127.0.0.1:8788',viewport={'width':1366,'height':768},reduced_motion='reduce',accept_downloads=True)
    owner=context.new_page();errors=[];owner.on('pageerror',lambda e:errors.append(str(e)))
    owner.goto('/');expect(owner.locator('#status')).to_have_text('Sẵn sàng')
    expect(owner.locator('#collection-dialog')).to_be_visible()
    expect(owner.locator('#collection-availability')).to_contain_text('chưa bật')
    expect(owner.locator('#collection-accept')).to_be_disabled()
    owner.locator('#close-collection').click();passed('Notice opens on entry even while collection is disabled; accept remains disabled')
    owner.locator('#admin-button').click()
    if owner.locator('#setup-token-row').is_visible():
        owner.locator('#setup-token').fill('test-owner-bootstrap')
        owner.locator('#admin-password').fill('test-password-123');owner.locator('#admin-confirm').fill('test-password-123')
        owner.locator('#admin-form button[type=submit]').click();expect(owner.locator('#admin-feedback')).to_contain_text('Đã tạo')
    owner.locator('#admin-password').fill('test-password-123');owner.locator('#admin-form button[type=submit]').click()
    expect(owner.locator('#admin-button')).to_have_text('Đăng xuất admin')
    owner.locator('#collection-settings').click()
    owner.locator('#collection-enabled').check()
    owner.locator('#collection-manager').fill('Nhóm thử nghiệm')
    owner.locator('#collection-manager-contact').fill('test@example.invalid')
    owner.locator('#collection-url').fill('https://script.google.com/macros/s/test-deployment/exec')
    owner.locator('#collection-secret').fill('synthetic-secret-12345678901234567890')
    owner.locator('#collection-settings-form button[type=submit]').click()
    expect(owner.locator('#collection-settings-dialog')).not_to_be_visible();passed('Admin checks and enables synthetic private Drive')

    guest_context=browser.new_context(base_url='http://127.0.0.1:8788',viewport={'width':1366,'height':768},reduced_motion='reduce',accept_downloads=True)
    guest=guest_context.new_page();guest.on('pageerror',lambda e:errors.append(str(e)));guest.goto('/')
    expect(guest.locator('#collection-dialog')).to_be_visible();passed('New visitor sees voluntary notice on entry')
    for checkbox in ['#collection-own','#collection-agree']:
        expect(guest.locator(checkbox)).not_to_be_checked()
    expect(guest.locator('#collection-accept')).to_be_disabled();passed('No prechecked agreement and no accepting without confirmations')
    screenshots=root/'runtime';guest.screenshot(path=str(screenshots/'collection-consent-desktop.png'),full_page=True)
    guest.locator('#collection-decline').click();expect(guest.locator('#collection-dialog')).not_to_be_visible()
    guest.locator('#image-files').set_input_files(photo());expect(guest.locator('#gallery button')).to_have_count(1)
    expect(guest.locator('#collection-photo-status')).to_be_empty();passed('Declining permits upload without contribution')
    guest.reload();expect(guest.locator('#gallery button')).to_have_count(1)
    expect(guest.locator('#collection-dialog')).to_be_visible()
    assert guest_context.request.get('/api/state').json()['collection']['accepted'] is False
    guest.locator('#close-collection').click();passed('Reload shows notice without resetting the declined consent')
    guest.locator('#collection-button').click()
    for checkbox in ['#collection-own','#collection-agree']:guest.locator(checkbox).check()
    guest.locator('#collection-accept').click();expect(guest.locator('#collection-receipt-panel')).to_be_visible()
    code=guest.locator('#collection-receipt').inner_text();assert len(code)==48
    with guest.expect_download() as info:guest.locator('#collection-download-code').click()
    assert 'ma-xoa-anh' in info.value.suggested_filename;passed('Explicit consent provides downloadable withdrawal code')
    guest.locator('#close-collection').click();guest.locator('#image-files').set_input_files(photo())
    expect(guest.locator('#gallery button')).to_have_count(2);expect(guest.locator('#collection-photo-status')).to_contain_text('1 ảnh đã lưu')
    passed('Only newly added photograph is contributed')

    other_context=browser.new_context(base_url='http://127.0.0.1:8788',viewport={'width':390,'height':844},reduced_motion='reduce')
    other=other_context.new_page();other.on('pageerror',lambda e:errors.append(str(e)));other.goto('/')
    expect(other.locator('#collection-dialog')).to_be_visible()
    assert other.locator('#collection-dialog').evaluate('(e)=>e.scrollWidth<=e.clientWidth+1')
    other.screenshot(path=str(screenshots/'collection-consent-mobile.png'),full_page=True);passed('Mobile notice scrolls internally without horizontal overflow')
    other.locator('.collection-withdrawal summary').click();other.locator('#collection-code').fill(code)
    other.locator('#collection-withdraw').click();expect(other.locator('#collection-feedback')).to_contain_text('xác nhận xóa ảnh')
    passed('Withdrawal code works from a different browser session')
    guest.reload();expect(guest.locator('#gallery button')).to_have_count(2)
    expect(guest.locator('#collection-dialog')).to_be_visible();guest.locator('#close-collection').click()
    expect(guest.locator('#collection-photo-status')).to_be_empty()
    passed('Revocation stops contribution in original session')
    assert not errors,errors;passed('No browser JavaScript errors')
    browser.close()
(root/'runtime/collection-browser-result.json').write_text(json.dumps({'passed':len(checks),'checks':checks,'drive':'synthetic','images':'synthetic'},ensure_ascii=False,indent=2),encoding='utf-8')
