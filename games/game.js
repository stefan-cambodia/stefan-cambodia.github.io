// Shared by the game pages: language switch (EN/FR/KM), in sync with the home page's choice.
(function () {
  var KEY = "portfolio-lang";
  function stored() { try { return localStorage.getItem(KEY); } catch (e) { return null; } }
  var lang = stored() === "fr" || stored() === "km" ? stored() : "en";
  function apply() {
    document.documentElement.lang = lang;
    var t = document.querySelector("title[data-" + lang + "]");
    if (t) document.title = t.getAttribute("data-" + lang);
  }
  apply();
  document.addEventListener("DOMContentLoaded", function () {
    var y = document.getElementById("year");
    if (y) y.textContent = new Date().getFullYear();
    var b = document.getElementById("langBtn");
    if (b) b.addEventListener("click", function () {
      lang = { en: "fr", fr: "km", km: "en" }[lang] || "en";
      try { localStorage.setItem(KEY, lang); } catch (e) {}
      apply();
    });
  });
})();
