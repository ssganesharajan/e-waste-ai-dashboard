/*
 * =====================================================================================
 *  IoT-Based E-Waste Classification System - Cloud-Ready ESP32-CAM Firmware
 * =====================================================================================
 *  Hardware Target : AI-Thinker ESP32-CAM (OV2640 Camera Module)
 *  Backend Target  : Cloud FastAPI Server (HTTP or HTTPS)
 *                    e.g. https://your-app.onrender.com/upload
 *                    or   https://api.ecosort.io/upload
 *                    or   http://192.168.1.100:8000/upload
 * 
 *  Features:
 *   - Supports Direct Cloud PUSH to any HTTP or HTTPS URL (Render, AWS, Railway, etc.)
 *   - Auto SSL/TLS support via WiFiClientSecure (no certificate management needed)
 *   - Push-on-Trigger: Push button (GPIO 13), Serial Command ('c'), or Local /push endpoint
 *   - Optional Automatic Periodic Push Interval (e.g. every 5-10 seconds)
 *   - Prints AI Classification Results directly to Serial Monitor from Cloud Response
 *   - Hosts fallback local HTTP snapshot server at /capture and / for local debugging
 *   - Flash LED toggle support for low-light scans
 * =====================================================================================
 */

#include "esp_camera.h"
#include <WiFi.h>
#include <HTTPClient.h>
#include <WiFiClientSecure.h>
#include "esp_timer.h"
#include "img_converters.h"
#include "Arduino.h"
#include "soc/soc.h"
#include "soc/rtc_cntl_reg.h"
#include "esp_http_server.h"

// =====================================================================================
// 1. WiFi & Cloud Configuration
// =====================================================================================

// Your WiFi Network Credentials
const char* ssid     = "YOUR_WIFI_SSID";
const char* password = "YOUR_WIFI_PASSWORD";

// Target Cloud AI Backend Endpoint (Accepts both HTTP and HTTPS Cloud URLs)
// When deployed on cloud platforms (Render, Railway, AWS, DigitalOcean, Heroku, etc.):
// Example HTTPS: "https://your-ewaste-dashboard.onrender.com/upload"
// Example Local: "http://192.168.1.100:8000/upload"
const char* CLOUD_SERVER_URL = "https://your-cloud-backend.com/upload";

// Push Trigger Configuration
#define TRIGGER_PIN              13     // Optional push-button switch (Connect between GPIO 13 and GND)
#define USE_AUTO_PUSH            false  // Set to true to automatically scan & push at regular intervals
#define AUTO_PUSH_INTERVAL_SEC   10     // Interval in seconds if USE_AUTO_PUSH is true

// =====================================================================================
// 2. AI-Thinker ESP32-CAM Pin Definitions
// =====================================================================================

#define PWDN_GPIO_NUM     32
#define RESET_GPIO_NUM    -1
#define XCLK_GPIO_NUM      0
#define SIOD_GPIO_NUM     26
#define SIOC_GPIO_NUM     27

#define Y9_GPIO_NUM       35
#define Y8_GPIO_NUM       34
#define Y7_GPIO_NUM       39
#define Y6_GPIO_NUM       36
#define Y5_GPIO_NUM       21
#define Y4_GPIO_NUM       19
#define Y3_GPIO_NUM       18
#define Y2_GPIO_NUM        5
#define VSYNC_GPIO_NUM    25
#define HREF_GPIO_NUM     23
#define PCLK_GPIO_NUM     22

#define FLASH_LED_PIN      4
#define ONBOARD_LED_PIN   33   // Small red status LED (Active LOW on AI-Thinker)

httpd_handle_t camera_httpd = NULL;
unsigned long lastAutoPushTime = 0;
bool lastButtonState = HIGH;

// =====================================================================================
// 3. Cloud Image Push Function (HTTP & HTTPS)
// =====================================================================================

/**
 * Captures a frame from OV2640 and pushes it via HTTP/HTTPS POST to CLOUD_SERVER_URL.
 * Supports SSL/TLS encryption for cloud hosting platforms.
 */
bool pushImageToCloud() {
    if (WiFi.status() != WL_CONNECTED) {
        Serial.println("❌ WiFi not connected! Skipping cloud push.");
        return false;
    }

    Serial.println("\n--------------------------------------------------");
    Serial.println("📸 [1/3] Capturing Frame from Camera Sensor...");

    // Blink flash LED briefly during capture
    digitalWrite(FLASH_LED_PIN, HIGH);
    delay(120);

    camera_fb_t * fb = esp_camera_fb_get();
    digitalWrite(FLASH_LED_PIN, LOW);

    if (!fb) {
        Serial.println("❌ Camera frame capture failed!");
        return false;
    }

    Serial.printf("✅ Frame captured! Size: %u bytes (%u x %u)\n", fb->len, fb->width, fb->height);
    Serial.printf("🌐 [2/3] Connecting to Cloud Endpoint: %s\n", CLOUD_SERVER_URL);

    bool isHttps = String(CLOUD_SERVER_URL).startsWith("https://");
    HTTPClient http;
    bool success = false;

    // Use secure or standard client based on URL protocol
    if (isHttps) {
        WiFiClientSecure *clientSecure = new WiFiClientSecure();
        if (clientSecure) {
            clientSecure->setInsecure(); // Skip certificate verification for universal cloud hosting compatibility
            http.begin(*clientSecure, CLOUD_SERVER_URL);
        } else {
            Serial.println("❌ Unable to create WiFiClientSecure");
            esp_camera_fb_return(fb);
            return false;
        }
    } else {
        WiFiClient client;
        http.begin(client, CLOUD_SERVER_URL);
    }

    // Set HTTP Headers
    http.addHeader("Content-Type", "image/jpeg");
    http.addHeader("User-Agent", "ESP32-CAM-EcoSort/2.0");
    http.setTimeout(12000); // 12 second timeout for cloud roundtrip

    // Indicate sending via onboard status LED
    digitalWrite(ONBOARD_LED_PIN, LOW);

    Serial.println("🚀 [3/3] Uploading Image Payload to AI Server...");
    unsigned long startTime = millis();

    // Send binary JPEG buffer
    int httpResponseCode = http.POST(fb->buf, fb->len);
    unsigned long durationMs = millis() - startTime;

    digitalWrite(ONBOARD_LED_PIN, HIGH);

    if (httpResponseCode > 0) {
        Serial.printf("✅ Cloud Response: HTTP %d (Latency: %lu ms)\n", httpResponseCode, durationMs);
        String responsePayload = http.getString();
        
        Serial.println("📥 AI Classification Response:");
        Serial.println(responsePayload);
        success = true;
    } else {
        Serial.printf("❌ Cloud POST Error: %s (Code: %d)\n", http.errorToString(httpResponseCode).c_str(), httpResponseCode);
    }

    http.end();
    esp_camera_fb_return(fb);
    Serial.println("--------------------------------------------------\n");

    return success;
}

// =====================================================================================
// 4. Local Web Server Handlers (For Local LAN fallback)
// =====================================================================================

// Handles GET /capture and /
static esp_err_t capture_handler(httpd_req_t *req) {
    camera_fb_t * fb = esp_camera_fb_get();
    if (!fb) {
        httpd_resp_send_500(req);
        return ESP_FAIL;
    }

    httpd_resp_set_type(req, "image/jpeg");
    httpd_resp_set_hdr(req, "Content-Disposition", "inline; filename=capture.jpg");
    httpd_resp_set_hdr(req, "Access-Control-Allow-Origin", "*");

    esp_err_t res = httpd_resp_send(req, (const char *)fb->buf, fb->len);
    esp_camera_fb_return(fb);
    return res;
}

// Handles GET /push (Triggers cloud push on demand via browser)
static esp_err_t trigger_push_handler(httpd_req_t *req) {
    bool ok = pushImageToCloud();
    const char* resp = ok ? "{\"status\":\"success\",\"message\":\"Image pushed to cloud successfully\"}" 
                          : "{\"status\":\"error\",\"message\":\"Cloud push failed\"}";
    httpd_resp_set_type(req, "application/json");
    httpd_resp_set_hdr(req, "Access-Control-Allow-Origin", "*");
    return httpd_resp_send(req, resp, strlen(resp));
}

// Handles GET /flash?state=1 or /flash?state=0
static esp_err_t flash_handler(httpd_req_t *req) {
    char buf[32];
    if (httpd_req_get_url_query_str(req, buf, sizeof(buf)) == ESP_OK) {
        char param[16];
        if (httpd_query_key_value(buf, "state", param, sizeof(param)) == ESP_OK) {
            int state = atoi(param);
            digitalWrite(FLASH_LED_PIN, state ? HIGH : LOW);
        }
    }
    const char* resp = "{\"status\":\"ok\"}";
    httpd_resp_set_type(req, "application/json");
    httpd_resp_set_hdr(req, "Access-Control-Allow-Origin", "*");
    return httpd_resp_send(req, resp, strlen(resp));
}

void startLocalWebServer() {
    httpd_config_t config = HTTPD_DEFAULT_CONFIG();
    config.server_port = 80;

    httpd_uri_t capture_uri = {
        .uri       = "/capture",
        .method    = HTTP_GET,
        .handler   = capture_handler,
        .user_ctx  = NULL
    };

    httpd_uri_t root_uri = {
        .uri       = "/",
        .method    = HTTP_GET,
        .handler   = capture_handler,
        .user_ctx  = NULL
    };

    httpd_uri_t push_uri = {
        .uri       = "/push",
        .method    = HTTP_GET,
        .handler   = trigger_push_handler,
        .user_ctx  = NULL
    };

    httpd_uri_t flash_uri = {
        .uri       = "/flash",
        .method    = HTTP_GET,
        .handler   = flash_handler,
        .user_ctx  = NULL
    };

    if (httpd_start(&camera_httpd, &config) == ESP_OK) {
        httpd_register_uri_handler(camera_httpd, &capture_uri);
        httpd_register_uri_handler(camera_httpd, &root_uri);
        httpd_register_uri_handler(camera_httpd, &push_uri);
        httpd_register_uri_handler(camera_httpd, &flash_uri);
        Serial.println("🌐 Local Camera Web Server active on port 80");
    }
}

// =====================================================================================
// 5. Setup & Main Loop
// =====================================================================================

void setup() {
    // Disable brownout detector for power stability during WiFi / Flash bursts
    WRITE_PERI_REG(RTC_CNTL_BROWN_OUT_REG, 0);

    Serial.begin(115200);
    Serial.setDebugOutput(false);
    Serial.println("\n==================================================");
    Serial.println("  EcoSort AI | Cloud-Ready ESP32-CAM Node v2.0    ");
    Serial.println("==================================================");

    pinMode(FLASH_LED_PIN, OUTPUT);
    digitalWrite(FLASH_LED_PIN, LOW);

    pinMode(ONBOARD_LED_PIN, OUTPUT);
    digitalWrite(ONBOARD_LED_PIN, HIGH); // OFF

    pinMode(TRIGGER_PIN, INPUT_PULLUP);

    // Configure Camera Hardware
    camera_config_t config;
    config.ledc_channel = LEDC_CHANNEL_0;
    config.ledc_timer   = LEDC_TIMER_0;
    config.pin_d0       = Y2_GPIO_NUM;
    config.pin_d1       = Y3_GPIO_NUM;
    config.pin_d2       = Y4_GPIO_NUM;
    config.pin_d3       = Y5_GPIO_NUM;
    config.pin_d4       = Y6_GPIO_NUM;
    config.pin_d5       = Y7_GPIO_NUM;
    config.pin_d6       = Y8_GPIO_NUM;
    config.pin_d7       = Y9_GPIO_NUM;
    config.pin_xclk     = XCLK_GPIO_NUM;
    config.pin_pclk     = PCLK_GPIO_NUM;
    config.pin_vsync    = VSYNC_GPIO_NUM;
    config.pin_href     = HREF_GPIO_NUM;
    config.pin_sccb_sda = SIOD_GPIO_NUM;
    config.pin_sccb_scl = SIOC_GPIO_NUM;
    config.pin_pwdn     = PWDN_GPIO_NUM;
    config.pin_reset    = RESET_GPIO_NUM;
    config.xclk_freq_hz = 20000000;
    config.pixel_format = PIXFORMAT_JPEG;

    // Set resolution (VGA 640x480 is optimal for MobileNetV2 224x224 input)
    if (psramFound()) {
        config.frame_size   = FRAMESIZE_VGA;  // 640x480
        config.jpeg_quality = 10;             // High quality
        config.fb_count     = 2;
    } else {
        config.frame_size   = FRAMESIZE_SVGA; // 800x600
        config.jpeg_quality = 12;
        config.fb_count     = 1;
    }

    // Initialize Camera Sensor
    esp_err_t err = esp_camera_init(&config);
    if (err != ESP_OK) {
        Serial.printf("❌ Camera initialization failed: 0x%x\n", err);
        return;
    }
    Serial.println("✅ Camera sensor initialized successfully.");

    // Connect to WiFi
    Serial.printf("📡 Connecting to WiFi SSID: %s ", ssid);
    WiFi.begin(ssid, password);
    while (WiFi.status() != WL_CONNECTED) {
        delay(400);
        Serial.print(".");
    }
    Serial.println("\n✅ WiFi Connected Successfully!");
    Serial.print("   Node Local IP: http://");
    Serial.println(WiFi.localIP());
    Serial.print("   Cloud Target : ");
    Serial.println(CLOUD_SERVER_URL);

    // Start local server
    startLocalWebServer();

    Serial.println("\n💡 Ready to scan!");
    Serial.println("   - Type 'c' in Serial Monitor to capture & push to cloud");
    Serial.println("   - Press physical button on GPIO 13 to trigger scan");
    Serial.println("   - Open http://<IP>/push in browser to trigger from network\n");
}

void loop() {
    // 1. Check Serial Input for trigger command
    if (Serial.available()) {
        char ch = Serial.read();
        if (ch == 'c' || ch == 'C') {
            Serial.println("\n⌨️ Serial trigger received! Capturing and pushing to cloud...");
            pushImageToCloud();
        }
    }

    // 2. Check Push Button on GPIO 13
    bool currentButtonState = digitalRead(TRIGGER_PIN);
    if (currentButtonState == LOW && lastButtonState == HIGH) {
        delay(50); // Debounce
        if (digitalRead(TRIGGER_PIN) == LOW) {
            Serial.println("\n🔘 Physical button pressed! Capturing and pushing to cloud...");
            pushImageToCloud();
        }
    }
    lastButtonState = currentButtonState;

    // 3. Check Automatic Interval Timer (if enabled)
    if (USE_AUTO_PUSH) {
        if (millis() - lastAutoPushTime > (AUTO_PUSH_INTERVAL_SEC * 1000UL)) {
            lastAutoPushTime = millis();
            Serial.println("\n⏰ Auto-interval timer triggered! Pushing frame to cloud...");
            pushImageToCloud();
        }
    }

    delay(20);
}
