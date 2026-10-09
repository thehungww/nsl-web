"""Run against the isolated browser-server.mjs on 8788. Uses synthetic photos/AI."""
import io
import json
from pathlib import Path
from PIL import Image
from playwright.sync_api import sync_playwright, expect

checks = []
def passed(name): checks.append(name); print(name, flush=True)
def image(name):
    data = io.BytesIO(); Image.new("RGB", (320, 240), "white").save(data, "PNG")
    return {"name": name, "mimeType": "image/png", "buffer": data.getvalue()}

with sync_playwright() as playwright:
    browser = playwright.chromium.launch(channel="msedge", headless=True, args=["--use-fake-device-for-media-stream", "--use-fake-ui-for-media-stream"])
    context = browser.new_context(base_url="http://127.0.0.1:8788", viewport={"width": 1366, "height": 768}, accept_downloads=True, permissions=["camera"])
    page = context.new_page(); errors=[]; page.on("pageerror", lambda error: errors.append(str(error)))
    page.goto("http://127.0.0.1:8788/"); expect(page.locator("#status")).to_have_text("Sẵn sàng")
    expect(page.locator("#remote-settings")).to_be_disabled(); passed("Guest management disabled")
    page.locator("#admin-button").click(); page.locator("#setup-token").fill("test-owner-bootstrap")
    page.locator("#admin-password").fill("test-password-123"); page.locator("#admin-confirm").fill("test-password-123")
    page.locator("#admin-form button[type=submit]").click(); expect(page.locator("#admin-feedback")).to_contain_text("Đã tạo")
    page.locator("#admin-password").fill("test-password-123"); page.locator("#admin-form button[type=submit]").click()
    expect(page.locator("#admin-button")).to_have_text("Đăng xuất admin"); passed("Owner bootstrap and login")
    page.locator("#remote-settings").click(); page.locator("#remote-name").fill("Mô hình kiểm thử")
    page.locator("#remote-endpoint-input").fill("https://test.a.run.app"); page.locator("#remote-key").fill("ul_test_only_12345678")
    page.locator("#remote-form button[type=submit]").click(); expect(page.locator("#remote-dialog")).not_to_be_visible()
    page.locator("#remote-model").select_option(label="Mô hình kiểm thử")
    expect(page.locator("#remote-model option:checked")).to_have_text("Mô hình kiểm thử")
    passed("Add shared remote model")
    page.locator("#chat-settings").click(); page.locator("#chat-key").fill("test-key-only-12345678")
    page.locator("#chat-settings-form button[type=submit]").click(); expect(page.locator("#chat-dialog")).not_to_be_visible()
    passed("Configure shared chatbot")
    page.locator("#question").fill("Chăm sóc da như nào?"); page.locator("#send").click()
    expect(page.locator(".bubble.assistant")).to_contain_text("tiếng Việt"); passed("Chat without images")
    page.locator("#image-files").set_input_files([image("first.png"), image("second.png")])
    expect(page.locator("#gallery button")).to_have_count(2); passed("Multiple uploads and JPEG compression")
    page.locator("#scan").click(); expect(page.locator("#status")).to_have_text("Đã quét 2/2 ảnh.")
    expect(page.locator("#image-chat-tab")).to_have_class("active"); passed("Scan automatically enters image chat")
    page.locator("#gallery button").nth(1).click(); page.locator("#analyze-image").click()
    expect(page.locator(".bubble.assistant")).to_contain_text("Ảnh 2"); expect(page.locator(".bubble.assistant")).to_contain_text("Mụn mủ")
    passed("Selected image context")
    page.locator('input[name=scope][value=all]').check(); page.locator("#analyze-image").click()
    expect(page.locator(".bubble.assistant")).to_contain_text("tat_ca_anh"); passed("All images context")
    with page.expect_download() as download_info: page.locator("#save-result").click()
    with Image.open(download_info.value.path()) as result: assert result.format == "PNG" and result.size == (320,240)
    passed("Annotated PNG download")
    page.locator(".sources button").first.click(); expect(page.locator("#source-dialog")).to_be_visible()
    pdf=page.request.get(page.locator("#source-pdf").get_attribute("href").split("#")[0]);assert pdf.ok and pdf.body().startswith(b"%PDF")
    page.locator("#close-source").click(); passed("Citation and original PDF")
    page.reload(); expect(page.locator("#gallery button.selected span")).to_contain_text("Ảnh 2")
    expect(page.locator('input[name=scope][value=all]')).to_be_checked(); passed("Reload preserves selected image and scope")
    page.locator("#camera-button").click(); expect(page.locator("#capture")).to_be_enabled(); page.locator("#capture").click()
    expect(page.locator("#gallery button")).to_have_count(3); passed("Capture camera photo")
    guest=browser.new_context(); other=guest.new_page();other.goto("http://127.0.0.1:8788/")
    expect(other.locator("#gallery button")).to_have_count(0);expect(other.locator("#remote-settings")).to_be_disabled();passed("Other browser private photos, shared model")
    for width,height in [(1366,768),(1024,700),(390,844)]:
        page.set_viewport_size({"width":width,"height":height});page.wait_for_timeout(100)
        overflow=page.evaluate("document.documentElement.scrollWidth>innerWidth")
        assert not overflow;passed(f"No horizontal overflow at {width}x{height}")
    assert not errors, errors;passed("No JavaScript page errors")
    browser.close()
print(json.dumps({"passed":len(checks),"checks":checks},ensure_ascii=False))
