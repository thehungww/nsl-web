"""Opt-in real deployment smoke. Uses a blank synthetic photo, never a patient photo."""
import io
import json
from pathlib import Path
import sys
from PIL import Image
from playwright.sync_api import sync_playwright, expect

if "--live" not in sys.argv:
    raise SystemExit("Run with --live to use the configured Gemini/Ultralytics APIs.")
url = "https://nsl.hung12122004.workers.dev"
with sync_playwright() as playwright:
    browser = playwright.chromium.launch(channel="msedge", headless=True)
    context = browser.new_context()
    page = context.new_page()
    errors = []
    page.on("pageerror", lambda error: errors.append(str(error)))
    page.goto(url, wait_until="networkidle")
    expect(page.locator("#remote-model option")).to_have_count(3)
    state = page.request.get(url + "/api/state").json()
    assert state["chat"]["configured"] and len(state["remote"]["models"]) == 2
    print("Online UI, shared models and key ready", flush=True)
    page.locator("#question").fill("Mụn đầu đen là gì và tôi nên chăm sóc da thế nào?")
    page.locator("#send").click()
    expect(page.locator("#send")).to_be_enabled(timeout=120000)
    if page.locator(".bubble.error").count(): raise RuntimeError(page.locator(".bubble.error").inner_text())
    answer = page.locator(".bubble.assistant").inner_text()
    assert len(answer) > 50
    print("Live Gemini answer and RAG citations:", page.locator(".sources button").count(), flush=True)
    page.locator(".sources button").first.click()
    expect(page.locator("#source-dialog")).to_be_visible()
    link = page.locator("#source-pdf").get_attribute("href")
    pdf = page.request.get(url + link.split("#")[0])
    assert pdf.ok and pdf.body().startswith(b"%PDF")
    page.locator("#close-source").click()
    print("Original cited PDF accessible", flush=True)
    image = io.BytesIO()
    Image.new("RGB", (320, 240), "white").save(image, "PNG")
    page.locator("#image-files").set_input_files({"name": "synthetic-smoke.png", "mimeType": "image/png", "buffer": image.getvalue()})
    expect(page.locator("#gallery button")).to_have_count(1)
    try:
        page.locator("#scan").click()
        expect(page.locator("#scan")).to_be_enabled(timeout=150000)
        scanned = page.request.get(url + "/api/state").json()
        photo = scanned["photos"][0]
        print(json.dumps({"real_inference_scanned": photo["scanned"], "error": photo["error"], "detected": len(photo.get("detections", []))}, ensure_ascii=False), flush=True)
        if not photo["scanned"]: raise RuntimeError("Live Ultralytics smoke failed")
        page.locator("#analyze-image").click()
        expect(page.locator("#send")).to_be_enabled(timeout=120000)
        if page.locator(".bubble.error").count(): raise RuntimeError(page.locator(".bubble.error").inner_text())
        assert page.locator(".bubble.assistant").count()
        print("Live image-context chatbot reply received", flush=True)
        with page.expect_download() as download_info: page.locator("#save-result").click()
        with Image.open(download_info.value.path()) as result: assert result.format == "PNG"
        assert not errors, errors
        report = {"root": True, "models": 2, "rag_reply": True, "sources": True, "real_remote_inference": True, "image_chat": True, "png_download": True, "page_errors": errors}
        runtime = Path(__file__).resolve().parents[1] / "runtime"
        runtime.mkdir(exist_ok=True)
        (runtime / "live-verification.json").write_text(json.dumps(report, indent=2), encoding="utf-8")
        print("Online end-to-end check passed", flush=True)
    finally:
        page.locator("#remove-image").click()
        expect(page.locator("#gallery button")).to_have_count(0)
        page.locator("#general-tab").click()
        page.locator("#new-chat").click()
        browser.close()
        print("Synthetic photo removed", flush=True)
