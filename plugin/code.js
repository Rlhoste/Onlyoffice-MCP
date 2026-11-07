(function (window) {
  "use strict";

  var socket = null;
  var reconnectTimer = null;
  var reconnectDelay = 1000;
  var MAX_RECONNECT_DELAY = 10000;
  var bridgeHistory = [];

  function send(id, result, error) {
    if (!socket || socket.readyState !== WebSocket.OPEN) return;
    socket.send(JSON.stringify({ id: id, result: result, error: error || null }));
  }

  function connect() {
    if (socket && (socket.readyState === WebSocket.OPEN || socket.readyState === WebSocket.CONNECTING)) return;
    clearTimeout(reconnectTimer);
    var url = "ws://127.0.0.1:2021/plugin?token=" + encodeURIComponent(window.ONLYOFFICE_BRIDGE_TOKEN || "");
    socket = new WebSocket(url);

    socket.onopen = function () {
      reconnectDelay = 1000;
      console.log("[OpenCode bridge] connected");
    };
    socket.onmessage = function (event) {
      try {
        handle(JSON.parse(event.data));
      } catch (error) {
        console.error("[OpenCode bridge] invalid command", error);
      }
    };
    socket.onerror = function () {
      if (socket) socket.close();
    };
    socket.onclose = function () {
      socket = null;
      reconnectTimer = setTimeout(connect, reconnectDelay);
      reconnectDelay = Math.min(reconnectDelay * 2, MAX_RECONNECT_DELAY);
    };
  }

  function inspectPresentation(id) {
    window.Asc.plugin.callCommand(function () {
      try {
        var presentation = Api.GetPresentation();
        if (!presentation) return { ok: false, error: "No presentation is open" };
        var slides = presentation.GetAllSlides ? presentation.GetAllSlides() : [];
        var current = presentation.GetCurSlideIndex ? presentation.GetCurSlideIndex() : null;
        var summaries = [];
        for (var i = 0; i < slides.length; i++) {
          var drawings = slides[i].GetAllDrawings ? slides[i].GetAllDrawings() : [];
          summaries.push({ index: i, drawingCount: drawings.length });
        }
        return {
          ok: true,
          editorType: "slide",
          slideCount: slides.length,
          currentSlideIndex: current,
          slides: summaries,
          capabilities: {
            getAllSlides: Boolean(presentation.GetAllSlides),
            getCurrentSlideIndex: Boolean(presentation.GetCurSlideIndex),
            createSlide: Boolean(presentation.CreateSlide),
            addSlide: Boolean(presentation.AddSlide),
            removeSlide: Boolean(presentation.RemoveSlide || presentation.RemoveSlides)
          }
        };
      } catch (error) {
        return { ok: false, error: String(error && error.message ? error.message : error) };
      }
    }, false, true, function (result) {
      send(id, result || { ok: false, error: "ONLYOFFICE returned no result" });
    });
  }

  function inspectSlide(id, params) {
    window.Asc.scope.bridgeSlideIndex = (typeof params.slideIndex === "number") ? params.slideIndex : null;
    window.Asc.plugin.callCommand(function () {
      function safeCall(object, method, fallback) {
        try {
          return object && typeof object[method] === "function" ? object[method]() : fallback;
        } catch (_) {
          return fallback;
        }
      }
      function finiteOrNull(value) {
        return typeof value === "number" && isFinite(value) ? value : null;
      }
      function sanitizeJson(value, depth, seen) {
        if (value === null || typeof value === "boolean") return value;
        if (typeof value === "number") return isFinite(value) ? value : null;
        if (typeof value === "string") return value.length > 500 ? value.substring(0, 500) + "…" : value;
        if (typeof value !== "object" || depth >= 6) return null;
        if (seen.indexOf(value) !== -1) return "[circular]";
        seen.push(value);
        if (Array.isArray(value)) {
          var arrayResult = [];
          for (var a = 0; a < value.length && a < 40; a++) arrayResult.push(sanitizeJson(value[a], depth + 1, seen));
          return arrayResult;
        }
        var objectResult = {};
        var keys = Object.keys(value);
        for (var k = 0; k < keys.length && k < 80; k++) objectResult[keys[k]] = sanitizeJson(value[keys[k]], depth + 1, seen);
        return objectResult;
      }
      function extractText(value) {
        var parts = [];
        var seen = [];
        function walk(item, key, depth) {
          if (parts.join(" ").length >= 500 || depth > 10) return;
          if (typeof item === "string" && /^(text|t|value|content)$/i.test(key) && item.replace(/\s/g, "")) {
            parts.push(item.replace(/^\s+|\s+$/g, ""));
            return;
          }
          if (!item || typeof item !== "object" || seen.indexOf(item) !== -1) return;
          seen.push(item);
          if (Array.isArray(item)) {
            for (var i = 0; i < item.length; i++) walk(item[i], key, depth + 1);
          } else {
            var keys = Object.keys(item);
            for (var j = 0; j < keys.length; j++) walk(item[keys[j]], keys[j], depth + 1);
          }
        }
        walk(value, "", 0);
        var text = parts.join(" ").replace(/\s+/g, " ").replace(/^\s+|\s+$/g, "");
        return text ? (text.length > 500 ? text.substring(0, 500) + "…" : text) : null;
      }
      function findNumber(value, acceptedKeys) {
        var seen = [];
        function walk(item, depth) {
          if (!item || typeof item !== "object" || depth > 8 || seen.indexOf(item) !== -1) return null;
          seen.push(item);
          var keys = Object.keys(item);
          for (var i = 0; i < keys.length; i++) {
            if (acceptedKeys.indexOf(keys[i]) !== -1 && typeof item[keys[i]] === "number" && isFinite(item[keys[i]])) return item[keys[i]];
          }
          for (var j = 0; j < keys.length; j++) {
            var found = walk(item[keys[j]], depth + 1);
            if (found !== null) return found;
          }
          return null;
        }
        return walk(value, 0);
      }
      try {
        var presentation = Api.GetPresentation();
        if (!presentation) return { ok: false, error: "No presentation is open" };
        var slides = presentation.GetAllSlides ? presentation.GetAllSlides() : [];
        var index = Asc.scope.bridgeSlideIndex;
        if (index === null || index === undefined) {
          index = presentation.GetCurSlideIndex ? presentation.GetCurSlideIndex() : 0;
        }
        if (index < 0 || index >= slides.length) {
          return { ok: false, error: "Slide index out of range", slideCount: slides.length };
        }
        var slide = slides[index];
        var drawings = slide.GetAllDrawings ? slide.GetAllDrawings() : [];
        var items = [];
        for (var i = 0; i < drawings.length; i++) {
          var drawing = drawings[i];
          var rawJson = null;
          try {
            rawJson = drawing.ToJSON ? drawing.ToJSON() : null;
            if (typeof rawJson === "string") {
              try { rawJson = JSON.parse(rawJson); } catch (_) {}
            }
          } catch (_) {}
          var safeJson = sanitizeJson(rawJson, 0, []);
          var jsonPreview = null;
          try {
            jsonPreview = safeJson === null ? null : JSON.stringify(safeJson);
            if (jsonPreview && jsonPreview.length > 3000) jsonPreview = jsonPreview.substring(0, 3000) + "…";
          } catch (_) {}
          items.push({
            index: i,
            classType: safeCall(drawing, "GetClassType", null),
            x: findNumber(safeJson, ["offX", "posX", "x", "X"]),
            y: findNumber(safeJson, ["offY", "posY", "y", "Y"]),
            width: finiteOrNull(safeCall(drawing, "GetWidth", null)),
            height: finiteOrNull(safeCall(drawing, "GetHeight", null)),
            text: extractText(safeJson),
            jsonPreview: jsonPreview
          });
        }
        return { ok: true, slideIndex: index, slideCount: slides.length, drawingCount: items.length, drawings: items };
      } catch (error) {
        return { ok: false, error: String(error && error.message ? error.message : error) };
      }
    }, false, true, function (result) {
      send(id, result || { ok: false, error: "ONLYOFFICE returned no result" });
    });
  }

  function addTextbox(id, params) {
    if (params.confirm !== true) {
      send(id, null, "Mutation refused: confirm must be true");
      return;
    }
    window.Asc.scope.bridgeTextbox = {
      text: String(params.text || ""),
      slideIndex: (typeof params.slideIndex === "number") ? params.slideIndex : null,
      xMm: Number(params.xMm),
      yMm: Number(params.yMm),
      widthMm: Number(params.widthMm),
      heightMm: Number(params.heightMm),
      fontSizePt: Number(params.fontSizePt)
    };
    window.Asc.plugin.callCommand(function () {
      try {
        var p = Asc.scope.bridgeTextbox;
        var presentation = Api.GetPresentation();
        if (!presentation) return { ok: false, error: "No presentation is open" };
        var slides = presentation.GetAllSlides ? presentation.GetAllSlides() : [];
        var index = p.slideIndex;
        if (index === null || index === undefined) {
          index = presentation.GetCurSlideIndex ? presentation.GetCurSlideIndex() : 0;
        }
        if (index < 0 || index >= slides.length) {
          return { ok: false, error: "Slide index out of range", slideCount: slides.length };
        }
        if (presentation.CreateNewHistoryPoint) presentation.CreateNewHistoryPoint();
        var mm = 36000;
        var fill = Api.CreateNoFill();
        var stroke = Api.CreateStroke(0, Api.CreateNoFill());
        var shape = Api.CreateShape("rect", p.widthMm * mm, p.heightMm * mm, fill, stroke);
        shape.SetPosition(p.xMm * mm, p.yMm * mm);
        if (shape.SetName) shape.SetName("OpenCode text box");
        var content = shape.GetDocContent();
        content.RemoveAllElements();
        var paragraph = Api.CreateParagraph();
        var run = Api.CreateRun();
        run.SetFontSize(p.fontSizePt * 2);
        run.AddText(p.text);
        paragraph.AddElement(run);
        content.Push(paragraph);
        slides[index].AddObject(shape);
        var editorApi = (typeof editor !== "undefined" && editor) ? editor : ((typeof Asc !== "undefined") ? Asc.editor : null);
        if (editorApi && editorApi.SetDocumentModified) editorApi.SetDocumentModified(true);
        var drawings = slides[index].GetAllDrawings ? slides[index].GetAllDrawings() : [];
        return {
          ok: true,
          slideIndex: index,
          drawingCount: drawings.length,
          drawingIndex: drawings.length - 1,
          width: p.widthMm * mm,
          height: p.heightMm * mm,
          addedName: "OpenCode text box"
        };
      } catch (error) {
        return { ok: false, error: String(error && error.message ? error.message : error) };
      }
    }, false, true, function (result) {
      if (result && result.ok) {
        bridgeHistory.push({
          type: "add_textbox",
          slideIndex: result.slideIndex,
          drawingIndex: result.drawingIndex,
          width: result.width,
          height: result.height
        });
      }
      send(id, result || { ok: false, error: "ONLYOFFICE returned no result" });
    });
  }

  function replaceShapeText(id, params) {
    if (params.confirm !== true) {
      send(id, null, "Mutation refused: confirm must be true");
      return;
    }
    window.Asc.scope.bridgeReplaceText = {
      slideIndex: Number(params.slideIndex),
      drawingIndex: Number(params.drawingIndex),
      text: String(params.text || "")
    };
    window.Asc.plugin.callCommand(function () {
      try {
        var p = Asc.scope.bridgeReplaceText;
        var presentation = Api.GetPresentation();
        if (!presentation) return { ok: false, error: "No presentation is open" };
        var slides = presentation.GetAllSlides ? presentation.GetAllSlides() : [];
        if (p.slideIndex < 0 || p.slideIndex >= slides.length) {
          return { ok: false, error: "Slide index out of range", slideCount: slides.length };
        }
        var drawings = slides[p.slideIndex].GetAllDrawings ? slides[p.slideIndex].GetAllDrawings() : [];
        if (p.drawingIndex < 0 || p.drawingIndex >= drawings.length) {
          return { ok: false, error: "Drawing index out of range", drawingCount: drawings.length };
        }
        var drawing = drawings[p.drawingIndex];
        var content = drawing.GetContent ? drawing.GetContent() : (drawing.GetDocContent ? drawing.GetDocContent() : null);
        if (!content || !content.GetElement) return { ok: false, error: "The selected drawing has no editable text content" };
        if (presentation.CreateNewHistoryPoint) presentation.CreateNewHistoryPoint();
        var paragraph = content.GetElement(0);
        if (paragraph && paragraph.SetText) {
          paragraph.SetText(p.text);
        } else if (content.RemoveAllElements && content.AddElement && Api.CreateParagraph) {
          content.RemoveAllElements();
          paragraph = Api.CreateParagraph();
          paragraph.AddText(p.text);
          content.AddElement(0, paragraph);
        } else {
          return { ok: false, error: "The selected drawing text cannot be replaced" };
        }
        var editorApi = (typeof editor !== "undefined" && editor) ? editor : ((typeof Asc !== "undefined") ? Asc.editor : null);
        if (editorApi && editorApi.SetDocumentModified) editorApi.SetDocumentModified(true);
        return {
          ok: true,
          slideIndex: p.slideIndex,
          drawingIndex: p.drawingIndex,
          text: p.text
        };
      } catch (error) {
        return { ok: false, error: String(error && error.message ? error.message : error) };
      }
    }, false, true, function (result) {
      if (result && result.ok) send(id, result);
      else send(id, null, result && result.error ? result.error : "Text replacement failed");
    });
  }

  function deleteSlide(id, params) {
    if (params.confirm !== true) {
      send(id, null, "Deletion refused: confirm must be true");
      return;
    }
    window.Asc.scope.bridgeDeleteSlideIndex = Number(params.slideIndex);
    window.Asc.plugin.callCommand(function () {
      try {
        var index = Asc.scope.bridgeDeleteSlideIndex;
        var presentation = Api.GetPresentation();
        if (!presentation) return { ok: false, error: "No presentation is open" };
        var slides = presentation.GetAllSlides ? presentation.GetAllSlides() : [];
        if (index < 0 || index >= slides.length) {
          return { ok: false, error: "Slide index out of range", slideCount: slides.length };
        }
        if (!presentation.RemoveSlide && !presentation.RemoveSlides) return { ok: false, error: "Slide removal is unavailable in this editor version" };
        if (presentation.CreateNewHistoryPoint) presentation.CreateNewHistoryPoint();
        var removed = presentation.RemoveSlide
          ? presentation.RemoveSlide(index)
          : presentation.RemoveSlides(index, 1);
        var editorApi = (typeof editor !== "undefined" && editor) ? editor : ((typeof Asc !== "undefined") ? Asc.editor : null);
        if (editorApi && editorApi.SetDocumentModified) editorApi.SetDocumentModified(true);
        var remaining = presentation.GetAllSlides ? presentation.GetAllSlides().length : null;
        return {
          ok: removed !== false,
          deletedSlideIndex: index,
          slideCount: remaining
        };
      } catch (error) {
        return { ok: false, error: String(error && error.message ? error.message : error) };
      }
    }, false, true, function (result) {
      if (result && result.ok) send(id, result);
      else send(id, null, result && result.error ? result.error : "Slide deletion failed");
    });
  }

  function deleteDrawing(id, params) {
    if (params.confirm !== true) {
      send(id, null, "Deletion refused: confirm must be true");
      return;
    }
    window.Asc.scope.bridgeDeleteDrawing = {
      slideIndex: Number(params.slideIndex),
      drawingIndex: Number(params.drawingIndex),
      expectedX: Number(params.expectedX),
      expectedY: Number(params.expectedY),
      expectedWidth: Number(params.expectedWidth),
      expectedHeight: Number(params.expectedHeight)
    };
    window.Asc.plugin.callCommand(function () {
      function findNumber(value, acceptedKeys) {
        var seen = [];
        function walk(item, depth) {
          if (!item || typeof item !== "object" || depth > 8 || seen.indexOf(item) !== -1) return null;
          seen.push(item);
          var keys = Object.keys(item);
          for (var i = 0; i < keys.length; i++) {
            if (acceptedKeys.indexOf(keys[i]) !== -1 && typeof item[keys[i]] === "number" && isFinite(item[keys[i]])) return item[keys[i]];
          }
          for (var j = 0; j < keys.length; j++) {
            var found = walk(item[keys[j]], depth + 1);
            if (found !== null) return found;
          }
          return null;
        }
        return walk(value, 0);
      }
      try {
        var p = Asc.scope.bridgeDeleteDrawing;
        var presentation = Api.GetPresentation();
        if (!presentation) return { ok: false, error: "No presentation is open" };
        var slides = presentation.GetAllSlides ? presentation.GetAllSlides() : [];
        if (p.slideIndex < 0 || p.slideIndex >= slides.length) {
          return { ok: false, error: "Slide index out of range", slideCount: slides.length };
        }
        var slide = slides[p.slideIndex];
        var drawings = slide.GetAllDrawings ? slide.GetAllDrawings() : [];
        if (p.drawingIndex < 0 || p.drawingIndex >= drawings.length) {
          return { ok: false, error: "Drawing index out of range", drawingCount: drawings.length };
        }
        var drawing = drawings[p.drawingIndex];
        var rawJson = drawing.ToJSON ? drawing.ToJSON() : null;
        if (typeof rawJson === "string") {
          try { rawJson = JSON.parse(rawJson); } catch (_) { rawJson = null; }
        }
        var actual = {
          x: findNumber(rawJson, ["offX", "posX", "x", "X"]),
          y: findNumber(rawJson, ["offY", "posY", "y", "Y"]),
          width: drawing.GetWidth ? drawing.GetWidth() : null,
          height: drawing.GetHeight ? drawing.GetHeight() : null
        };
        var mismatch = [];
        if (actual.x !== p.expectedX) mismatch.push("x");
        if (actual.y !== p.expectedY) mismatch.push("y");
        if (actual.width !== p.expectedWidth) mismatch.push("width");
        if (actual.height !== p.expectedHeight) mismatch.push("height");
        if (mismatch.length) {
          return { ok: false, error: "Drawing safety check failed: " + mismatch.join(", "), actual: actual };
        }
        if (!drawing.Delete) return { ok: false, error: "The target drawing cannot be deleted" };
        if (presentation.CreateNewHistoryPoint) presentation.CreateNewHistoryPoint();
        var deleted = drawing.Delete();
        var editorApi = (typeof editor !== "undefined" && editor) ? editor : ((typeof Asc !== "undefined") ? Asc.editor : null);
        if (editorApi && editorApi.SetDocumentModified) editorApi.SetDocumentModified(true);
        var remaining = slide.GetAllDrawings ? slide.GetAllDrawings().length : null;
        return {
          ok: deleted !== false,
          slideIndex: p.slideIndex,
          deletedDrawingIndex: p.drawingIndex,
          drawingCount: remaining
        };
      } catch (error) {
        return { ok: false, error: String(error && error.message ? error.message : error) };
      }
    }, false, true, function (result) {
      if (result && result.ok) send(id, result);
      else send(id, null, result && result.error ? result.error : "Drawing deletion failed");
    });
  }

  function undo(id, params) {
    if (params.confirm !== true) {
      send(id, null, "Undo refused: confirm must be true");
      return;
    }
    if (bridgeHistory.length === 0) {
      send(id, null, "No bridge edit is available to roll back");
      return;
    }
    var entry = bridgeHistory[bridgeHistory.length - 1];
    window.Asc.scope.bridgeRollback = entry;
    window.Asc.plugin.callCommand(function () {
      try {
        var rollback = Asc.scope.bridgeRollback;
        var presentation = Api.GetPresentation();
        if (!presentation) return { ok: false, error: "No presentation is open" };
        var slides = presentation.GetAllSlides ? presentation.GetAllSlides() : [];
        if (rollback.slideIndex < 0 || rollback.slideIndex >= slides.length) {
          return { ok: false, error: "Rollback slide no longer exists" };
        }
        var slide = slides[rollback.slideIndex];
        var drawings = slide.GetAllDrawings ? slide.GetAllDrawings() : [];
        if (rollback.drawingIndex < 0 || rollback.drawingIndex >= drawings.length) {
          return { ok: false, error: "Rollback object no longer exists" };
        }
        var drawing = drawings[rollback.drawingIndex];
        var width = drawing.GetWidth ? drawing.GetWidth() : null;
        var height = drawing.GetHeight ? drawing.GetHeight() : null;
        if (width !== rollback.width || height !== rollback.height) {
          return { ok: false, error: "Rollback safety check failed: the target object changed" };
        }
        if (!drawing.Delete) return { ok: false, error: "The target object cannot be deleted" };
        if (presentation.CreateNewHistoryPoint) presentation.CreateNewHistoryPoint();
        var deleted = drawing.Delete();
        var editorApi = (typeof editor !== "undefined" && editor) ? editor : ((typeof Asc !== "undefined") ? Asc.editor : null);
        if (editorApi && editorApi.SetDocumentModified) editorApi.SetDocumentModified(true);
        var remaining = slide.GetAllDrawings ? slide.GetAllDrawings().length : null;
        return {
          ok: deleted !== false,
          slideIndex: rollback.slideIndex,
          deletedDrawingIndex: rollback.drawingIndex,
          drawingCount: remaining
        };
      } catch (error) {
        return { ok: false, error: String(error && error.message ? error.message : error) };
      }
    }, false, true, function (result) {
      if (result && result.ok) bridgeHistory.pop();
      if (result && result.ok) send(id, result);
      else send(id, null, result && result.error ? result.error : "Rollback failed");
    });
  }

  function handle(message) {
    if (!message || typeof message.id !== "string") return;
    var params = message.params || {};
    if (message.method === "ping") {
      send(message.id, { ok: true, pong: true });
    } else if (message.method === "presentation_inspect") {
      inspectPresentation(message.id);
    } else if (message.method === "slide_inspect") {
      inspectSlide(message.id, params);
    } else if (message.method === "add_textbox") {
      addTextbox(message.id, params);
    } else if (message.method === "replace_shape_text") {
      replaceShapeText(message.id, params);
    } else if (message.method === "delete_slide") {
      deleteSlide(message.id, params);
    } else if (message.method === "delete_drawing") {
      deleteDrawing(message.id, params);
    } else if (message.method === "undo") {
      undo(message.id, params);
    } else {
      send(message.id, null, "Unknown or forbidden method: " + String(message.method));
    }
  }

  window.Asc.plugin.init = function () {
    connect();
  };

  window.Asc.plugin.onDocumentOpen = function () {
    connect();
  };
})(window);
