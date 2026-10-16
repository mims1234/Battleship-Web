// Classic ↔ v2 switch. Self-contained: adds a floating "V2" button to the classic page
// without touching the classic game code. Preference is remembered in localStorage.
(function () {
    var KEY = "battleship-version";
    var script = document.currentScript;
    var root = script && script.src ? script.src.replace(/public\/scripts\/v2-toggle\.js.*$/, "") : "./";
    var v2Url = root + "v2/";

    function get() { try { return localStorage.getItem(KEY); } catch (e) { return null; } }
    function set(v) { try { localStorage.setItem(KEY, v); } catch (e) { /* ignore */ } }

    var params = new URLSearchParams(location.search);
    if (params.get("v") === "1") set("v1");
    else if (params.get("v") === "2" || get() === "v2") {
        location.replace(v2Url);
        return;
    }

    function mount() {
        var btn = document.createElement("a");
        btn.href = v2Url;
        btn.setAttribute("aria-label", "Switch to Battleship v2");
        btn.title = "Try Battleship v2: 3D ocean, ship abilities, campaign, online duels";
        btn.innerHTML = '<span style="font-size:0.7em;opacity:.8;letter-spacing:.2em">TRY</span> V2 <i class="fa-solid fa-arrow-right"></i>';
        btn.style.cssText = [
            "position:fixed", "right:16px", "bottom:calc(16px + env(safe-area-inset-bottom, 0px))", "z-index:9999",
            "display:inline-flex", "align-items:center", "gap:8px", "padding:10px 16px", "border-radius:999px",
            "font-family:Orbitron, sans-serif", "font-weight:800", "letter-spacing:.12em", "font-size:14px",
            "color:#12100a", "text-decoration:none", "background:linear-gradient(135deg,#f2d59c,#c8a24a)",
            "box-shadow:0 8px 28px rgba(0,0,0,.45), 0 0 0 3px rgba(200,162,74,.25)", "transition:transform .15s ease"
        ].join(";");
        btn.addEventListener("mouseenter", function () { btn.style.transform = "translateY(-2px) scale(1.03)"; });
        btn.addEventListener("mouseleave", function () { btn.style.transform = ""; });
        btn.addEventListener("click", function () { set("v2"); });
        document.body.appendChild(btn);
    }

    if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", mount);
    else mount();
})();
