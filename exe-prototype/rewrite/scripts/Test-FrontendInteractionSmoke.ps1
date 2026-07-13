param(
    [int]$Port = 1422,
    [string]$OutputDir = "",
    [switch]$Quick,
    [int]$ReadyTimeoutSeconds = 60
)

$ErrorActionPreference = "Stop"

$ScriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$RewriteRoot = Resolve-Path (Join-Path $ScriptDir "..")
$PrototypeRoot = Resolve-Path (Join-Path $RewriteRoot "..")
$WebRoot = Join-Path $RewriteRoot "web"
if (-not $OutputDir) {
    $OutputDir = Join-Path $PrototypeRoot "outputs\codelens-next\v14.15-route-audit"
}

$JsonPath = Join-Path $OutputDir "interaction-smoke.json"
$MarkdownPath = Join-Path $OutputDir "interaction-smoke.md"
$BrowserUserDataRoot = Join-Path $OutputDir ".interaction-browser"
$CdpCommandId = 0
$RouteResults = New-Object 'System.Collections.Generic.List[object]'
$CaseResults = New-Object 'System.Collections.Generic.List[object]'
$KnownOwnerSelectors = @(
    "[role='dialog']",
    "[role='alertdialog']",
    "[role='menu']",
    "[role='listbox']",
    "[role='tabpanel']",
    "[aria-modal='true']",
    "[role='status']",
    "[role='alert']",
    ".product-command-palette-next",
    ".report-outline-popover-v149",
    ".report-actions-drawer-v131",
    ".system-drawer-v139",
    ".workspace-scan-dialog-v145",
    ".workspace-delete-dialog-v146",
    ".card-delete-dialog-v141",
    ".history-delete-dialog-v148"
)
$InformationalRouteNames = @("galaxy")

function Find-Browser {
    $candidates = @(
        (Join-Path $env:ProgramFiles "Microsoft\Edge\Application\msedge.exe"),
        (Join-Path ${env:ProgramFiles(x86)} "Microsoft\Edge\Application\msedge.exe"),
        (Join-Path $env:ProgramFiles "Google\Chrome\Application\chrome.exe"),
        (Join-Path ${env:ProgramFiles(x86)} "Google\Chrome\Application\chrome.exe")
    )

    foreach ($candidate in $candidates) {
        if ($candidate -and (Test-Path $candidate)) {
            return $candidate
        }
    }

    foreach ($command in @("msedge", "chrome", "chrome.exe")) {
        $resolved = Get-Command $command -ErrorAction SilentlyContinue
        if ($resolved) {
            return $resolved.Source
        }
    }

    throw "No Edge or Chrome executable was found for the interaction smoke test."
}

function Stop-ProcessTree {
    param([Parameter(Mandatory = $true)][int]$TargetProcessId)

    $children = Get-CimInstance Win32_Process -Filter "ParentProcessId = $TargetProcessId" -ErrorAction SilentlyContinue
    foreach ($child in $children) {
        Stop-ProcessTree -TargetProcessId $child.ProcessId
    }

    $process = Get-Process -Id $TargetProcessId -ErrorAction SilentlyContinue
    if ($process) {
        Stop-Process -Id $TargetProcessId -Force -ErrorAction SilentlyContinue
    }
}

function Get-FreeTcpPort {
    $listener = [System.Net.Sockets.TcpListener]::new([System.Net.IPAddress]::Loopback, 0)
    try {
        $listener.Start()
        return $listener.LocalEndpoint.Port
    } finally {
        $listener.Stop()
    }
}

function Get-TcpListenerProcessId {
    param([Parameter(Mandatory = $true)][int]$LocalPort)

    try {
        $connection = Get-NetTCPConnection -State Listen -LocalPort $LocalPort -ErrorAction Stop | Select-Object -First 1
        if ($connection) {
            return [int]$connection.OwningProcess
        }
    } catch {
    }

    foreach ($line in @(netstat.exe -ano -p tcp 2>$null)) {
        if ($line -match ("^\s*TCP\s+\S+:" + $LocalPort + "\s+\S+\s+LISTENING\s+(\d+)\s*$")) {
            return [int]$Matches[1]
        }
    }
    return 0
}

function Wait-HttpReady {
    param(
        [Parameter(Mandatory = $true)][string]$Url,
        [int]$TimeoutSeconds = 60
    )

    $deadline = (Get-Date).AddSeconds($TimeoutSeconds)
    do {
        try {
            $response = Invoke-WebRequest -Uri $Url -UseBasicParsing -TimeoutSec 2
            if ($response.StatusCode -ge 200 -and $response.StatusCode -lt 500) {
                return
            }
        } catch {
            Start-Sleep -Milliseconds 400
        }
    } while ((Get-Date) -lt $deadline)

    throw "Vite dev preview did not become ready: $Url"
}

function Invoke-JsonHttp {
    param([Parameter(Mandatory = $true)][string]$Url)

    $response = Invoke-WebRequest -Uri $Url -UseBasicParsing -TimeoutSec 3
    return ($response.Content | ConvertFrom-Json)
}

function Wait-CdpWebSocketUrl {
    param(
        [Parameter(Mandatory = $true)][int]$CdpPort,
        [int]$TimeoutSeconds = 30
    )

    $deadline = (Get-Date).AddSeconds($TimeoutSeconds)
    do {
        try {
            $targets = Invoke-JsonHttp -Url "http://127.0.0.1:$CdpPort/json/list"
            $page = @($targets | Where-Object { $_.type -eq "page" -and $_.webSocketDebuggerUrl } | Select-Object -First 1)
            if ($page.Count -gt 0) {
                return [string]$page[0].webSocketDebuggerUrl
            }
        } catch {
            Start-Sleep -Milliseconds 300
        }
    } while ((Get-Date) -lt $deadline)

    throw "CDP endpoint did not become ready on port $CdpPort."
}

function Open-CdpClient {
    param([Parameter(Mandatory = $true)][string]$WebSocketUrl)

    $client = New-Object System.Net.WebSockets.ClientWebSocket
    $client.Options.KeepAliveInterval = [TimeSpan]::FromSeconds(15)
    $connectResult = $client.ConnectAsync([Uri]$WebSocketUrl, [System.Threading.CancellationToken]::None).GetAwaiter().GetResult()
    return $client
}

function Close-CdpClient {
    param([Parameter(Mandatory = $true)]$Client)

    if ($Client.State -eq [System.Net.WebSockets.WebSocketState]::Open) {
        try {
            $closeResult = $Client.CloseAsync(
                [System.Net.WebSockets.WebSocketCloseStatus]::NormalClosure,
                "interaction smoke complete",
                [System.Threading.CancellationToken]::None
            ).GetAwaiter().GetResult()
        } catch {
        }
    }
    $Client.Dispose()
}

function Receive-CdpMessage {
    param([Parameter(Mandatory = $true)]$Client)

    $buffer = New-Object byte[] 65536
    $stream = New-Object System.IO.MemoryStream
    try {
        do {
            $segment = [System.ArraySegment[byte]]::new($buffer)
            $received = $Client.ReceiveAsync($segment, [System.Threading.CancellationToken]::None).GetAwaiter().GetResult()
            if ($received.MessageType -eq [System.Net.WebSockets.WebSocketMessageType]::Close) {
                throw "CDP websocket closed while waiting for a response."
            }
            $stream.Write($buffer, 0, $received.Count)
        } while (-not $received.EndOfMessage)

        $text = [System.Text.Encoding]::UTF8.GetString($stream.ToArray())
        return ($text | ConvertFrom-Json)
    } finally {
        $stream.Dispose()
    }
}

function Invoke-CdpCommand {
    param(
        [Parameter(Mandatory = $true)]$Client,
        [Parameter(Mandatory = $true)][string]$Method,
        [hashtable]$Parameters = @{}
    )

    $script:CdpCommandId += 1
    $command = [ordered]@{
        id = $script:CdpCommandId
        method = $Method
        params = $Parameters
    }
    $json = $command | ConvertTo-Json -Depth 30 -Compress
    $bytes = [System.Text.Encoding]::UTF8.GetBytes($json)
    $segment = [System.ArraySegment[byte]]::new($bytes)
    $sendResult = $Client.SendAsync(
        $segment,
        [System.Net.WebSockets.WebSocketMessageType]::Text,
        $true,
        [System.Threading.CancellationToken]::None
    ).GetAwaiter().GetResult()

    do {
        $message = Receive-CdpMessage -Client $Client
    } while ($message.id -ne $script:CdpCommandId)

    if ($message.error) {
        throw "CDP $Method failed: $($message.error.message)"
    }
    return $message
}

function ConvertTo-JavaScriptString {
    param([Parameter(Mandatory = $true)][string]$Value)
    return ($Value | ConvertTo-Json -Compress)
}

function Invoke-CdpJson {
    param(
        [Parameter(Mandatory = $true)]$Client,
        [Parameter(Mandatory = $true)][string]$Expression
    )

    $runtimeExpression = "JSON.stringify($Expression)"
    $message = Invoke-CdpCommand -Client $Client -Method "Runtime.evaluate" -Parameters @{
        expression = $runtimeExpression
        returnByValue = $true
        awaitPromise = $true
        userGesture = $true
    }
    if ($message.result.exceptionDetails) {
        throw "Page evaluation failed: $($message.result.exceptionDetails.text)"
    }
    $value = $message.result.result.value
    if ($null -eq $value) {
        throw "Page evaluation returned no JSON value."
    }
    return ($value | ConvertFrom-Json)
}

function Wait-PageSettled {
    param(
        [Parameter(Mandatory = $true)]$Client,
        [int]$TimeoutMilliseconds = 6000
    )

    $deadline = (Get-Date).AddMilliseconds($TimeoutMilliseconds)
    do {
        try {
            $state = Invoke-CdpJson -Client $Client -Expression @"
(function() {
    var root = document.getElementById("root");
    return {
        ready: document.readyState === "complete",
        root: !!root,
        content: !!(root && root.children.length)
    };
})()
"@
            if ($state.ready -and $state.root -and $state.content) {
                Start-Sleep -Milliseconds 150
                return
            }
        } catch {
        }
        Start-Sleep -Milliseconds 100
    } while ((Get-Date) -lt $deadline)

    throw "The route did not settle before the timeout."
}

function Set-CdpViewport {
    param(
        [Parameter(Mandatory = $true)]$Client,
        [Parameter(Mandatory = $true)][int]$Width,
        [Parameter(Mandatory = $true)][int]$Height,
        [Parameter(Mandatory = $true)][string]$Theme
    )

    Invoke-CdpCommand -Client $Client -Method "Emulation.setDeviceMetricsOverride" -Parameters @{
        width = $Width
        height = $Height
        deviceScaleFactor = 1
        mobile = $false
        screenWidth = $Width
        screenHeight = $Height
    } | Out-Null
    Invoke-CdpCommand -Client $Client -Method "Emulation.setEmulatedMedia" -Parameters @{
        features = @(@{ name = "prefers-color-scheme"; value = $Theme })
    } | Out-Null
}

function Navigate-CdpPage {
    param(
        [Parameter(Mandatory = $true)]$Client,
        [Parameter(Mandatory = $true)][string]$Url,
        [Parameter(Mandatory = $true)][string]$Theme
    )

    $themeLiteral = ConvertTo-JavaScriptString -Value $Theme
    Invoke-CdpCommand -Client $Client -Method "Page.addScriptToEvaluateOnNewDocument" -Parameters @{
        source = "try { window.localStorage.setItem('codelens.theme', $themeLiteral); } catch (error) {}"
    } | Out-Null
    $lastError = $null
    for ($attempt = 1; $attempt -le 2; $attempt += 1) {
        try {
            Invoke-CdpCommand -Client $Client -Method "Page.navigate" -Parameters @{ url = $Url } | Out-Null
            Wait-PageSettled -Client $Client
            return
        } catch {
            $lastError = $_
            if ($attempt -lt 2) {
                Start-Sleep -Milliseconds 250
            }
        }
    }
    throw "The route did not settle after 2 navigation attempts: $($lastError.Exception.Message)"
}

function Get-VisibleControlSnapshot {
    param(
        [Parameter(Mandatory = $true)]$Client,
        [Parameter(Mandatory = $true)][string]$KnownOwnerSelectorText
    )

    $selectorLiteral = ConvertTo-JavaScriptString -Value "button:not([disabled]), [role='button']:not([aria-disabled='true']), input:not([type='hidden']):not([disabled]), select:not([disabled]), textarea:not([disabled]), a[href], [tabindex]:not([tabindex='-1'])"
    $ownerLiteral = ConvertTo-JavaScriptString -Value $KnownOwnerSelectorText
    return Invoke-CdpJson -Client $Client -Expression @"
(function() {
    var selector = $selectorLiteral;
    var ownerSelector = $ownerLiteral;
    var viewportWidth = window.innerWidth;
    var viewportHeight = window.innerHeight;
    var elements = Array.from(document.querySelectorAll(selector));

    var rectData = function(rect) {
        return {
            left: rect.left,
            top: rect.top,
            right: rect.right,
            bottom: rect.bottom,
            width: rect.width,
            height: rect.height
        };
    };
    var pointInside = function(x, y, rect) {
        return x >= rect.left && x <= rect.right && y >= rect.top && y <= rect.bottom;
    };
    var rectIntersects = function(first, second) {
        return first.right > second.left && first.bottom > second.top && first.left < second.right && first.top < second.bottom;
    };
    var labelFor = function(element) {
        return element.getAttribute("aria-label") || element.getAttribute("title") || element.getAttribute("name") ||
            (element.textContent || "").replace(/\s+/g, " ").trim().slice(0, 100) || element.tagName.toLowerCase();
    };
    var targetLabel = function(element) {
        if (!element) return "";
        var id = element.id ? "#" + element.id : "";
        var className = typeof element.className === "string" ? element.className.trim().replace(/\s+/g, ".") : "";
        return element.tagName.toLowerCase() + id + (className ? "." + className : "");
    };
    var inactiveReason = function(element) {
        var node = element;
        while (node && node.nodeType === 1) {
            var style = window.getComputedStyle(node);
            if (node.hidden) return "hidden-attribute";
            if (node.getAttribute("aria-hidden") === "true") return "aria-hidden";
            if (node.hasAttribute("inert")) return "inert";
            if (style.display === "none") return "display-none";
            if (style.visibility === "hidden" || style.visibility === "collapse") return "visibility-hidden";
            if (parseFloat(style.opacity || "1") <= 0.01) return "transparent";
            if (style.pointerEvents === "none") return "pointer-events-none";

            if (node !== element && style.transform !== "none" && (style.position === "absolute" || style.position === "fixed")) {
                var panelRect = node.getBoundingClientRect();
                var panelArea = Math.max(0, panelRect.width) * Math.max(0, panelRect.height);
                if (panelArea > 0 && (panelRect.width >= 120 || panelRect.height >= 120)) {
                    var visibleWidth = Math.max(0, Math.min(panelRect.right, viewportWidth) - Math.max(panelRect.left, 0));
                    var visibleHeight = Math.max(0, Math.min(panelRect.bottom, viewportHeight) - Math.max(panelRect.top, 0));
                    var visibleRatio = (visibleWidth * visibleHeight) / panelArea;
                    var panelCenterVisible = pointInside(
                        panelRect.left + panelRect.width / 2,
                        panelRect.top + panelRect.height / 2,
                        { left: 0, top: 0, right: viewportWidth, bottom: viewportHeight }
                    );
                    if (!panelCenterVisible && visibleRatio < 0.5) return "closed-transformed-offcanvas";
                }
            }
            node = node.parentElement;
        }
        return "";
    };
    var clipsAxis = function(value) {
        return value === "auto" || value === "scroll" || value === "overlay" || value === "hidden" || value === "clip";
    };
    var effectiveClip = function(element) {
        var clip = { left: 0, top: 0, right: viewportWidth, bottom: viewportHeight };
        var node = element.parentElement;
        while (node && node !== document.body && node !== document.documentElement) {
            var style = window.getComputedStyle(node);
            var rect = node.getBoundingClientRect();
            if (clipsAxis(style.overflowX)) {
                clip.left = Math.max(clip.left, rect.left);
                clip.right = Math.min(clip.right, rect.right);
            }
            if (clipsAxis(style.overflowY)) {
                clip.top = Math.max(clip.top, rect.top);
                clip.bottom = Math.min(clip.bottom, rect.bottom);
            }
            node = node.parentElement;
        }
        return clip;
    };
    var scrollableAncestors = function(element) {
        var result = [];
        var node = element.parentElement;
        while (node && node !== document.body && node !== document.documentElement) {
            var style = window.getComputedStyle(node);
            var scrollX = (style.overflowX === "auto" || style.overflowX === "scroll" || style.overflowX === "overlay") && node.scrollWidth > node.clientWidth + 1;
            var scrollY = (style.overflowY === "auto" || style.overflowY === "scroll" || style.overflowY === "overlay") && node.scrollHeight > node.clientHeight + 1;
            if (scrollX || scrollY) result.push({ element: node, scrollX: scrollX, scrollY: scrollY });
            node = node.parentElement;
        }
        return result;
    };
    var ownerFor = function(element) {
        var owner = element.closest(ownerSelector);
        if (!owner) return null;
        var ownerStyle = window.getComputedStyle(owner);
        var ownerRect = owner.getBoundingClientRect();
        var ownerVisible = ownerRect.width > 0 && ownerRect.height > 0 &&
            ownerRect.right > 0 && ownerRect.bottom > 0 && ownerRect.left < viewportWidth && ownerRect.top < viewportHeight &&
            ownerStyle.display !== "none" && ownerStyle.visibility !== "hidden" && parseFloat(ownerStyle.opacity || "1") > 0.01 &&
            owner.getAttribute("aria-hidden") !== "true";
        return {
            kind: owner.getAttribute("role") || (typeof owner.className === "string" ? owner.className : "") || owner.tagName.toLowerCase(),
            portal: owner.parentElement === document.body,
            visible: ownerVisible,
            rect: rectData(ownerRect)
        };
    };
    var evaluateAtCurrentPosition = function(element) {
        var rect = element.getBoundingClientRect();
        var clip = effectiveClip(element);
        var centerX = rect.left + rect.width / 2;
        var centerY = rect.top + rect.height / 2;
        var viewportRect = { left: 0, top: 0, right: viewportWidth, bottom: viewportHeight };
        var centerInViewport = pointInside(centerX, centerY, viewportRect);
        var centerInClip = centerInViewport && pointInside(centerX, centerY, clip);
        var intersectsClip = rectIntersects(rect, clip);
        var target = centerInClip ? document.elementFromPoint(centerX, centerY) : null;
        var centerHit = !!target && (target === element || element.contains(target));
        var owner = ownerFor(element);
        var ownerBoundaryPass = !owner || (owner.visible && pointInside(centerX, centerY, owner.rect));
        return {
            rect: rectData(rect),
            effectiveClip: rectData(clip),
            center: { x: centerX, y: centerY },
            centerInViewport: centerInViewport,
            centerInClip: centerInClip,
            intersectsClip: intersectsClip,
            centerHit: centerHit,
            hitTarget: targetLabel(target),
            owner: owner,
            ownerBoundaryPass: ownerBoundaryPass,
            placementPass: centerInViewport && centerInClip && ownerBoundaryPass
        };
    };
    var probeInScrollContainers = function(element, scrollers) {
        var saved = scrollers.map(function(item) {
            return {
                element: item.element,
                scrollLeft: item.element.scrollLeft,
                scrollTop: item.element.scrollTop,
                scrollBehavior: item.element.style.scrollBehavior
            };
        });
        var result = null;
        try {
            saved.forEach(function(item) { item.element.style.scrollBehavior = "auto"; });
            for (var pass = 0; pass < 2; pass += 1) {
                scrollers.forEach(function(item) {
                    var elementRect = element.getBoundingClientRect();
                    var scrollerRect = item.element.getBoundingClientRect();
                    if (item.scrollX) item.element.scrollLeft += (elementRect.left + elementRect.width / 2) - (scrollerRect.left + scrollerRect.width / 2);
                    if (item.scrollY) item.element.scrollTop += (elementRect.top + elementRect.height / 2) - (scrollerRect.top + scrollerRect.height / 2);
                });
            }
            result = evaluateAtCurrentPosition(element);
            result.passed = result.placementPass && result.centerHit;
        } finally {
            saved.slice().reverse().forEach(function(item) {
                item.element.scrollLeft = item.scrollLeft;
                item.element.scrollTop = item.scrollTop;
                item.element.style.scrollBehavior = item.scrollBehavior;
            });
        }
        return result;
    };

    var controls = [];
    var visibleControls = [];
    var scrollableControls = [];
    var ignoredControls = [];
    var failures = [];
    elements.forEach(function(element, index) {
        var rect = element.getBoundingClientRect();
        var reason = inactiveReason(element);
        if (!reason && (rect.width <= 0 || rect.height <= 0)) reason = "zero-size";
        if (reason) {
            ignoredControls.push({ index: index, tag: element.tagName.toLowerCase(), label: labelFor(element), reason: reason });
            return;
        }

        var current = evaluateAtCurrentPosition(element);
        var row = {
            index: index,
            tag: element.tagName.toLowerCase(),
            role: element.getAttribute("role") || "",
            label: labelFor(element),
            disposition: "",
            rect: current.rect,
            effectiveClip: current.effectiveClip,
            center: current.center,
            centerInViewport: current.centerInViewport,
            centerInClip: current.centerInClip,
            centerHit: current.centerHit,
            hitTarget: current.hitTarget,
            owner: current.owner,
            ownerBoundaryPass: current.ownerBoundaryPass,
            placementPass: current.placementPass,
            passed: false,
            scrollProbe: null
        };

        var currentlyVisible = current.intersectsClip && current.centerInViewport && current.centerInClip;
        if (currentlyVisible) {
            row.disposition = "visible";
            row.passed = current.placementPass && current.centerHit;
            visibleControls.push(row);
            controls.push(row);
            if (!row.passed) failures.push(row);
            return;
        }

        var scrollers = scrollableAncestors(element);
        if (scrollers.length > 0) {
            var probe = probeInScrollContainers(element, scrollers);
            row.disposition = "internal-scroll";
            row.scrollProbe = probe;
            row.passed = probe.passed;
            scrollableControls.push(row);
            controls.push(row);
            if (!row.passed) failures.push(row);
            return;
        }

        row.disposition = "offscreen-unscrolled";
        ignoredControls.push({ index: index, tag: row.tag, label: row.label, reason: row.disposition });
    });
    var ignoredReasonCounts = {};
    ignoredControls.forEach(function(row) {
        ignoredReasonCounts[row.reason] = (ignoredReasonCounts[row.reason] || 0) + 1;
    });
    return {
        viewport: { width: viewportWidth, height: viewportHeight },
        renderedControlCount: controls.length,
        visibleControlCount: visibleControls.length,
        scrollableControlCount: scrollableControls.length,
        ignoredControlCount: ignoredControls.length,
        controls: controls,
        visibleControls: visibleControls,
        scrollableControls: scrollableControls,
        ignoredControls: ignoredControls,
        ignoredReasonCounts: ignoredReasonCounts,
        failures: failures,
        passed: failures.length === 0,
        knownOwnerSelector: ownerSelector
    };
})()
"@
}

function Invoke-CdpClickSelector {
    param(
        [Parameter(Mandatory = $true)]$Client,
        [Parameter(Mandatory = $true)][string]$Selector
    )

    $selectorLiteral = ConvertTo-JavaScriptString -Value $Selector
    return Invoke-CdpJson -Client $Client -Expression @"
(function() {
    var element = document.querySelector($selectorLiteral);
    if (!element) return { found: false, selector: $selectorLiteral };
    element.scrollIntoView({ block: "center", inline: "center" });
    element.focus();
    element.click();
    return { found: true, selector: $selectorLiteral };
})()
"@
}

function Invoke-CdpClickButtonByText {
    param(
        [Parameter(Mandatory = $true)]$Client,
        [Parameter(Mandatory = $true)][string]$Text
    )

    $textLiteral = ConvertTo-JavaScriptString -Value $Text
    return Invoke-CdpJson -Client $Client -Expression @"
(function() {
    var target = Array.from(document.querySelectorAll("button")).find(function(button) {
        return (button.textContent || "").replace(/\s+/g, " ").trim() === $textLiteral;
    });
    if (!target) return { found: false, text: $textLiteral };
    target.scrollIntoView({ block: "center", inline: "center" });
    target.focus();
    target.click();
    return { found: true, text: $textLiteral };
})()
"@
}

function Get-VisibleDialog {
    param(
        [Parameter(Mandatory = $true)]$Client,
        [Parameter(Mandatory = $true)][string]$Role
    )

    $roleLiteral = ConvertTo-JavaScriptString -Value $Role
    return Invoke-CdpJson -Client $Client -Expression @"
(function() {
    var selector = "[role=" + $roleLiteral + "]";
    var element = Array.from(document.querySelectorAll(selector)).find(function(candidate) {
        var rect = candidate.getBoundingClientRect();
        var style = window.getComputedStyle(candidate);
        return rect.width > 0 && rect.height > 0 && style.display !== "none" && style.visibility !== "hidden" && parseFloat(style.opacity || "1") > 0.01 && candidate.getAttribute("aria-hidden") !== "true";
    });
    if (!element) return { found: false, role: $roleLiteral };
    var focusable = Array.from(element.querySelectorAll("a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex='-1'])"));
    return {
        found: true,
        role: $roleLiteral,
        focusableCount: focusable.length,
        activeInside: element.contains(document.activeElement),
        activeTag: document.activeElement ? document.activeElement.tagName.toLowerCase() : "",
        activeLabel: document.activeElement ? (document.activeElement.getAttribute("aria-label") || document.activeElement.getAttribute("title") || document.activeElement.textContent || "").replace(/\s+/g, " ").trim().slice(0, 80) : ""
    };
})()
"@
}

function Invoke-CdpKey {
    param(
        [Parameter(Mandatory = $true)]$Client,
        [Parameter(Mandatory = $true)][string]$Key,
        [Parameter(Mandatory = $true)][int]$VirtualKeyCode,
        [int]$Modifiers = 0
    )

    Invoke-CdpCommand -Client $Client -Method "Input.dispatchKeyEvent" -Parameters @{
        type = "keyDown"
        key = $Key
        code = $Key
        modifiers = $Modifiers
        windowsVirtualKeyCode = $VirtualKeyCode
        nativeVirtualKeyCode = $VirtualKeyCode
    } | Out-Null
    Invoke-CdpCommand -Client $Client -Method "Input.dispatchKeyEvent" -Parameters @{
        type = "keyUp"
        key = $Key
        code = $Key
        modifiers = $Modifiers
        windowsVirtualKeyCode = $VirtualKeyCode
        nativeVirtualKeyCode = $VirtualKeyCode
    } | Out-Null
}

function Get-DialogOpenerManifest {
    $deleteLabel = -join @([char]0x5220, [char]0x9664, [char]0x6863, [char]0x6848, [char]0x20)
    return @(
        [pscustomobject]@{
            name = "settings-profile-drawer"
            route = "settings"
            openerSelector = ".settings-add-profile-v139"
            expectedRole = "dialog"
        }
        [pscustomobject]@{
            name = "settings-profile-delete"
            route = "settings"
            openerSelector = "button[aria-label^='$deleteLabel']"
            expectedRole = "alertdialog"
        }
    )
}

function Test-DialogFocusContract {
    param(
        [Parameter(Mandatory = $true)]$Client,
        [Parameter(Mandatory = $true)][string]$Name,
        [Parameter(Mandatory = $true)][string]$OpenerSelector,
        [Parameter(Mandatory = $true)][string]$ExpectedRole
    )

    $record = [ordered]@{
        name = $Name
        openerSelector = $OpenerSelector
        expectedRole = $ExpectedRole
        available = $false
        opened = $false
        initialFocusContained = $false
        tabFocusContained = $false
        shiftTabFocusContained = $false
        escaped = $false
        returnedFocus = $false
        passed = $false
        note = ""
    }

    $openerLiteral = ConvertTo-JavaScriptString -Value $OpenerSelector
    $expectedRoleLiteral = ConvertTo-JavaScriptString -Value $ExpectedRole
    $openerState = Invoke-CdpJson -Client $Client -Expression @"
(function() {
    var opener = document.querySelector($openerLiteral);
    if (!opener) return { found: false };
    return { found: true, disabled: !!opener.disabled || opener.getAttribute("aria-disabled") === "true" };
})()
"@
    if (-not $openerState.found) {
        $record.note = "opener not mounted on this route"
        return [pscustomobject]$record
    }
    if ($openerState.disabled) {
        $record.note = "opener is disabled"
        return [pscustomobject]$record
    }
    $record.available = $true

    $click = Invoke-CdpClickSelector -Client $Client -Selector $OpenerSelector
    if (-not $click.found) {
        $record.note = "opener disappeared before click"
        return [pscustomobject]$record
    }

    $dialog = $null
    $deadline = (Get-Date).AddSeconds(2)
    do {
        try {
            $dialog = Get-VisibleDialog -Client $Client -Role $ExpectedRole
            if ($dialog.found) {
                break
            }
        } catch {
        }
        Start-Sleep -Milliseconds 80
    } while ((Get-Date) -lt $deadline)

    if (-not $dialog -or -not $dialog.found) {
        $record.note = "expected role did not open"
        return [pscustomobject]$record
    }
    $record.opened = $true
    $record.initialFocusContained = [bool]$dialog.activeInside

    Invoke-CdpKey -Client $Client -Key "Tab" -VirtualKeyCode 9
    Start-Sleep -Milliseconds 60
    $afterTab = Get-VisibleDialog -Client $Client -Role $ExpectedRole
    $record.tabFocusContained = [bool]$afterTab.activeInside

    Invoke-CdpKey -Client $Client -Key "Tab" -VirtualKeyCode 9 -Modifiers 8
    Start-Sleep -Milliseconds 60
    $afterShiftTab = Get-VisibleDialog -Client $Client -Role $ExpectedRole
    $record.shiftTabFocusContained = [bool]$afterShiftTab.activeInside

    Invoke-CdpKey -Client $Client -Key "Escape" -VirtualKeyCode 27
    $afterEscape = $null
    $returnFocusDeadline = (Get-Date).AddSeconds(1)
    do {
        Start-Sleep -Milliseconds 50
        $afterEscape = Invoke-CdpJson -Client $Client -Expression @"
(function() {
    var opener = document.querySelector($openerLiteral);
    var dialog = document.querySelector("[role=" + $expectedRoleLiteral + "]");
    var dialogVisible = false;
    if (dialog) {
        var rect = dialog.getBoundingClientRect();
        var style = window.getComputedStyle(dialog);
        dialogVisible = rect.width > 0 && rect.height > 0 && style.display !== "none" && style.visibility !== "hidden" && parseFloat(style.opacity || "1") > 0.01;
    }
    return {
        dialogVisible: dialogVisible,
        returnedFocus: !!opener && document.activeElement === opener,
        activeTag: document.activeElement ? document.activeElement.tagName.toLowerCase() : ""
    };
})()
"@
        if (-not $afterEscape.dialogVisible -and $afterEscape.returnedFocus) {
            break
        }
    } while ((Get-Date) -lt $returnFocusDeadline)
    $record.escaped = -not [bool]$afterEscape.dialogVisible
    $record.returnedFocus = [bool]$afterEscape.returnedFocus
    $record.passed = $record.initialFocusContained -and $record.tabFocusContained -and $record.shiftTabFocusContained -and $record.escaped -and $record.returnedFocus
    if (-not $record.passed) {
        $record.note = "focus containment or return-focus contract failed"
    }
    return [pscustomobject]$record
}

function Invoke-RouteFocusChecks {
    param(
        [Parameter(Mandatory = $true)]$Client,
        [Parameter(Mandatory = $true)][string]$Route
    )

    $checks = New-Object 'System.Collections.Generic.List[object]'
    if ($Route -ne "settings") {
        return $checks.ToArray()
    }

    $profilesLabel = New-Object 'System.Char[]' 4
    $profilesLabel[0] = [char]0x6a21
    $profilesLabel[1] = [char]0x578b
    $profilesLabel[2] = [char]0x6863
    $profilesLabel[3] = [char]0x6848
    $sectionClick = Invoke-CdpClickButtonByText -Client $Client -Text (-join $profilesLabel)
    if ($sectionClick.found) {
        Start-Sleep -Milliseconds 100
    }

    foreach ($opener in @(Get-DialogOpenerManifest | Where-Object { $_.route -eq $Route })) {
        $check = Test-DialogFocusContract -Client $Client -Name $opener.name -OpenerSelector $opener.openerSelector -ExpectedRole $opener.expectedRole
        $checks.Add($check)
    }
    return $checks.ToArray()
}

function Get-RouteDefinitions {
    if ($Quick) {
        return @(
            [pscustomobject]@{ name = "galaxy"; query = "?view=galaxy&galaxy=explore" }
            [pscustomobject]@{ name = "workbench"; query = "?view=workbench" }
            [pscustomobject]@{ name = "settings"; query = "?view=settings" }
            [pscustomobject]@{ name = "history"; query = "?view=history" }
        )
    }

    return @(
        [pscustomobject]@{ name = "galaxy"; query = "?view=galaxy&galaxy=explore" }
        [pscustomobject]@{ name = "workbench"; query = "?view=workbench" }
        [pscustomobject]@{ name = "map"; query = "?view=map" }
        [pscustomobject]@{ name = "guide"; query = "?view=guide" }
        [pscustomobject]@{ name = "findings"; query = "?view=findings" }
        [pscustomobject]@{ name = "diff"; query = "?view=diff" }
        [pscustomobject]@{ name = "chat"; query = "?view=chat" }
        [pscustomobject]@{ name = "cards"; query = "?view=cards" }
        [pscustomobject]@{ name = "logs"; query = "?view=logs" }
        [pscustomobject]@{ name = "agent"; query = "?view=agent" }
        [pscustomobject]@{ name = "history"; query = "?view=history" }
        [pscustomobject]@{ name = "settings"; query = "?view=settings" }
        [pscustomobject]@{ name = "health"; query = "?view=health" }
    )
}

function Get-MatrixDefinitions {
    $viewports = @(
        [pscustomobject]@{ name = "1440x1000"; width = 1440; height = 1000 }
        [pscustomobject]@{ name = "1280x820"; width = 1280; height = 820 }
        [pscustomobject]@{ name = "900x720"; width = 900; height = 720 }
        [pscustomobject]@{ name = "390x720"; width = 390; height = 720 }
    )
    $themes = @("dark", "light")
    if ($Quick) {
        $viewports = @($viewports[0], $viewports[3])
    }

    $matrix = New-Object 'System.Collections.Generic.List[object]'
    foreach ($theme in $themes) {
        foreach ($viewport in $viewports) {
            $matrix.Add([pscustomobject]@{
                id = "$theme-$($viewport.name)"
                theme = $theme
                viewport = $viewport.name
                width = $viewport.width
                height = $viewport.height
            })
        }
    }
    return $matrix.ToArray()
}

function New-CaseMarkdown {
    param([Parameter(Mandatory = $true)]$Case)

    $status = if ($Case.passed) { "PASS" } else { "FAIL" }
    $lines = New-Object 'System.Collections.Generic.List[string]'
    $lines.Add("### ${status}: $($Case.id)")
    $lines.Add(('- Theme: `{0}`' -f $Case.theme))
    $lines.Add(('- Viewport: `{0}`' -f $Case.viewport))
    $lines.Add(('- Browser: `{0}`' -f $Case.browser))
    $lines.Add("- Routes: $($Case.routeCount)")
    $lines.Add("- Visible controls: $($Case.visibleControlCount)")
    $lines.Add("- Internal-scroll controls: $($Case.scrollableControlCount)")
    $lines.Add("- Ignored inactive/offscreen controls: $($Case.ignoredControlCount)")
    $lines.Add("- Control failures: $($Case.controlFailureCount)")
    $lines.Add("- Informational findings: $($Case.informationalCount)")
    $lines.Add("- Focus failures: $($Case.focusFailureCount)")
    if ($Case.error) {
        $lines.Add(('- Error: `{0}`' -f $Case.error))
    }
    return $lines
}

function Write-Evidence {
    param(
        [Parameter(Mandatory = $true)][string]$RunStatus,
        [string]$RunError = "",
        [Parameter(Mandatory = $true)][string]$BrowserPath,
        [Parameter(Mandatory = $true)][string]$DevUrl,
        [Parameter(Mandatory = $true)][datetime]$StartedAt,
        [Parameter(Mandatory = $true)][datetime]$FinishedAt
    )

    New-Item -ItemType Directory -Force -Path $OutputDir | Out-Null
    $caseArray = @($CaseResults.ToArray())
    $routeArray = @($caseArray | ForEach-Object { @($_.routes) })
    $json = [ordered]@{
        schema = "codelens-next.interaction-smoke.v14.15.1"
        status = $RunStatus
        error = $RunError
        startedAt = $StartedAt.ToString("o")
        finishedAt = $FinishedAt.ToString("o")
        command = "npm run dev:preview -- --port $Port"
        url = $DevUrl
        browser = $BrowserPath
        quick = [bool]$Quick
        matrix = @(Get-MatrixDefinitions)
        knownOwnerSelectors = $KnownOwnerSelectors
        geometryPolicy = [ordered]@{
            informationalRoutes = $InformationalRouteNames
            currentControls = "The control center must be inside the viewport and effective overflow clip, hit the control or its descendant, and remain inside an allowlisted owner when present."
            internalScroll = "Controls outside the current clip are centered in normal auto/scroll/overlay ancestors, checked, and all scroll positions are restored."
            ignored = "Semantically hidden, inert, pointer-disabled, zero-size, closed transformed offcanvas, and non-scrollable offscreen controls are excluded from hard failures."
        }
        summary = [ordered]@{
            caseCount = $caseArray.Count
            routeCount = $routeArray.Count
            visibleControlCount = [int](@($routeArray | Measure-Object -Property visibleControlCount -Sum).Sum)
            scrollableControlCount = [int](@($routeArray | Measure-Object -Property scrollableControlCount -Sum).Sum)
            ignoredControlCount = [int](@($routeArray | Measure-Object -Property ignoredControlCount -Sum).Sum)
            controlFailureCount = [int](@($routeArray | Measure-Object -Property controlFailureCount -Sum).Sum)
            informationalCount = [int](@($routeArray | Measure-Object -Property informationalCount -Sum).Sum)
            focusFailureCount = [int](@($routeArray | Measure-Object -Property focusFailureCount -Sum).Sum)
        }
        openerManifest = @(Get-DialogOpenerManifest)
        cases = $caseArray
    }
    $utf8 = New-Object System.Text.UTF8Encoding -ArgumentList $false
    [System.IO.File]::WriteAllText($JsonPath, ($json | ConvertTo-Json -Depth 40), $utf8)

    $markdown = New-Object System.Collections.Generic.List[string]
    $markdown.Add("# CodeLens Next interaction smoke")
    $markdown.Add("")
    $markdown.Add("- Status: **$RunStatus**")
    $markdown.Add((('- Command: `npm run dev:preview -- --port {0}`' -f $Port)))
    $markdown.Add(('- URL: `{0}`' -f $DevUrl))
    $markdown.Add(('- Browser: `{0}`' -f $BrowserPath))
    $markdownMode = if ($Quick) { "quick" } else { "full" }
    $markdown.Add(('- Mode: `{0}`' -f $markdownMode))
    $markdown.Add("- Matrix: dark/light x 1440x1000, 1280x820, 900x720, 390x720")
    $markdown.Add("")
    $markdown.Add('The hard DOM audit checks each currently visible control center against the viewport, effective overflow clip, allowlisted owner panel (including portals), and `elementFromPoint` self/descendant hit. Controls outside the current clip are temporarily centered in normal internal scroll containers, checked, and restored. Hidden/inert controls and closed transformed offcanvas panels are excluded. The `galaxy` Three.js showcase is informational only. Dialog checks cover initial focus, Tab, Shift+Tab, Escape, and return focus through the known opener manifest.')
    $markdown.Add("")
    foreach ($case in $CaseResults.ToArray()) {
        foreach ($line in (New-CaseMarkdown -Case $case)) {
            $markdown.Add($line)
        }
        $markdown.Add("")
        foreach ($route in @($case.routes)) {
            $routeStatus = if ($route.passed) { "PASS" } else { "FAIL" }
            $markdown.Add(('- {0} `{1}` mode={2}, visible={3}, scroll={4}, ignored={5}, hard={6}, info={7}, focus={8}' -f $routeStatus, $route.route, $route.auditMode, $route.visibleControlCount, $route.scrollableControlCount, $route.ignoredControlCount, $route.controlFailureCount, $route.informationalCount, $route.focusFailureCount))
            foreach ($failure in @($route.controlFailures | Select-Object -First 8)) {
                $failureHit = if ($failure.disposition -eq "internal-scroll") { $failure.scrollProbe.centerHit } else { $failure.centerHit }
                $failureOwner = if ($failure.disposition -eq "internal-scroll") { $failure.scrollProbe.ownerBoundaryPass } else { $failure.ownerBoundaryPass }
                $markdown.Add(('  hard: `{0}` disposition={1}, centerHit={2}, ownerBoundary={3}' -f $failure.label, $failure.disposition, $failureHit, $failureOwner))
            }
            if ($route.error) {
                $markdown.Add(('  error: `{0}`' -f $route.error))
            }
        }
        $markdown.Add("")
    }
    if ($RunError) {
        $markdown.Add("## Run error")
        $markdown.Add("")
        $markdown.Add(('`{0}`' -f $RunError))
    }
    [System.IO.File]::WriteAllText($MarkdownPath, ($markdown -join [Environment]::NewLine), $utf8)
}

$BrowserPath = ""
$DevUrl = "http://127.0.0.1:$Port"
$DevProcess = $null
$DevServerProcessId = 0
$CdpClient = $null
$BrowserProcess = $null
$StartedAt = Get-Date
$FinishedAt = $StartedAt
$RunError = ""
$RunStatus = "failed"

try {
    New-Item -ItemType Directory -Force -Path $OutputDir | Out-Null
    if (Test-Path $BrowserUserDataRoot) {
        Remove-Item -LiteralPath $BrowserUserDataRoot -Recurse -Force
    }
    $existingListenerProcessId = Get-TcpListenerProcessId -LocalPort $Port
    if ($existingListenerProcessId) {
        throw "Port $Port is already owned by process $existingListenerProcessId; refusing to reuse an unowned dev server."
    }

    $BrowserPath = Find-Browser
    $npm = Get-Command npm.cmd -ErrorAction SilentlyContinue
    if (-not $npm) {
        $npm = Get-Command npm -ErrorAction Stop
    }

    Push-Location $WebRoot
    try {
        $DevProcess = Start-Process -FilePath $npm.Source -ArgumentList @("run", "dev:preview", "--", "--port", "$Port") -PassThru -WindowStyle Hidden
    } finally {
        Pop-Location
    }
    Wait-HttpReady -Url $DevUrl -TimeoutSeconds $ReadyTimeoutSeconds
    $DevServerProcessId = Get-TcpListenerProcessId -LocalPort $Port
    if (-not $DevServerProcessId) {
        throw "The dev preview responded but no listener process was found on port $Port."
    }

    $routes = Get-RouteDefinitions
    foreach ($matrixCase in @(Get-MatrixDefinitions)) {
        $caseRoutes = New-Object 'System.Collections.Generic.List[object]'
        $case = [ordered]@{
            id = $matrixCase.id
            theme = $matrixCase.theme
            viewport = $matrixCase.viewport
            width = $matrixCase.width
            height = $matrixCase.height
            browser = $BrowserPath
            passed = $false
            routeCount = 0
            visibleControlCount = 0
            scrollableControlCount = 0
            ignoredControlCount = 0
            controlFailureCount = 0
            informationalCount = 0
            focusFailureCount = 0
            error = ""
            routes = @()
        }
        $caseCdpPort = Get-FreeTcpPort
        $caseUserData = Join-Path $BrowserUserDataRoot $matrixCase.id
        New-Item -ItemType Directory -Force -Path $caseUserData | Out-Null
        try {
            $browserArguments = @(
                "--headless=new",
                "--remote-debugging-port=$caseCdpPort",
                "--remote-allow-origins=*",
                "--disable-background-networking",
                "--disable-component-update",
                "--disable-default-apps",
                "--disable-extensions",
                "--disable-gpu",
                "--disable-sync",
                "--no-default-browser-check",
                "--no-first-run",
                "--user-data-dir=$caseUserData",
                "--window-size=$($matrixCase.width),$($matrixCase.height)",
                "$DevUrl/?view=galaxy&galaxy=explore"
            )
            $BrowserProcess = Start-Process -FilePath $BrowserPath -ArgumentList $browserArguments -PassThru -WindowStyle Hidden
            $webSocketUrl = Wait-CdpWebSocketUrl -CdpPort $caseCdpPort
            $CdpClient = Open-CdpClient -WebSocketUrl $webSocketUrl
            Set-CdpViewport -Client $CdpClient -Width $matrixCase.width -Height $matrixCase.height -Theme $matrixCase.theme

            foreach ($route in $routes) {
                $routeRecord = [ordered]@{
                    case = $matrixCase.id
                    theme = $matrixCase.theme
                    viewport = $matrixCase.viewport
                    route = $route.name
                    url = "$DevUrl/$($route.query)"
                    auditMode = if ($InformationalRouteNames -contains $route.name) { "informational" } else { "hard" }
                    passed = $false
                    controlCount = 0
                    renderedControlCount = 0
                    visibleControlCount = 0
                    scrollableControlCount = 0
                    ignoredControlCount = 0
                    ignoredReasonCounts = @{}
                    controlFailureCount = 0
                    controlFailures = @()
                    informationalCount = 0
                    informationalFindings = @()
                    focusFailureCount = 0
                    focusChecks = @()
                    error = ""
                }
                try {
                    Navigate-CdpPage -Client $CdpClient -Url $routeRecord.url -Theme $matrixCase.theme
                    $snapshot = Get-VisibleControlSnapshot -Client $CdpClient -KnownOwnerSelectorText ($KnownOwnerSelectors -join ",")
                    $routeRecord.controlCount = @($snapshot.controls).Count
                    $routeRecord.renderedControlCount = [int]$snapshot.renderedControlCount
                    $routeRecord.visibleControlCount = [int]$snapshot.visibleControlCount
                    $routeRecord.scrollableControlCount = [int]$snapshot.scrollableControlCount
                    $routeRecord.ignoredControlCount = [int]$snapshot.ignoredControlCount
                    $routeRecord.ignoredReasonCounts = $snapshot.ignoredReasonCounts
                    if ($routeRecord.auditMode -eq "informational") {
                        $routeRecord.informationalFindings = @($snapshot.failures)
                        $routeRecord.informationalCount = @($snapshot.failures).Count
                    } else {
                        $routeRecord.controlFailures = @($snapshot.failures)
                        $routeRecord.controlFailureCount = @($snapshot.failures).Count
                    }
                    if ($route.name -eq "settings") {
                        $focusChecks = Invoke-RouteFocusChecks -Client $CdpClient -Route $route.name
                        $routeRecord.focusChecks = @($focusChecks)
                        $routeRecord.focusFailureCount = @($focusChecks | Where-Object { $_.available -and -not $_.passed }).Count
                    }
                    $routeRecord.passed = $routeRecord.controlFailureCount -eq 0 -and $routeRecord.focusFailureCount -eq 0
                } catch {
                    $routeRecord.error = $_.Exception.Message
                }
                $routeObject = [pscustomobject]$routeRecord
                $caseRoutes.Add($routeObject)
                $RouteResults.Add($routeObject)
            }
            $case.routeCount = $caseRoutes.Count
            $case.visibleControlCount = [int](@($caseRoutes | Measure-Object -Property visibleControlCount -Sum).Sum)
            $case.scrollableControlCount = [int](@($caseRoutes | Measure-Object -Property scrollableControlCount -Sum).Sum)
            $case.ignoredControlCount = [int](@($caseRoutes | Measure-Object -Property ignoredControlCount -Sum).Sum)
            $case.controlFailureCount = [int](@($caseRoutes | Measure-Object -Property controlFailureCount -Sum).Sum)
            $case.informationalCount = [int](@($caseRoutes | Measure-Object -Property informationalCount -Sum).Sum)
            $case.focusFailureCount = [int](@($caseRoutes | Measure-Object -Property focusFailureCount -Sum).Sum)
            $case.passed = (@($caseRoutes | Where-Object { -not $_.passed }).Count -eq 0)
            $case.routes = $caseRoutes.ToArray()
        } catch {
            $case.error = $_.Exception.Message
        } finally {
            if ($CdpClient) {
                Close-CdpClient -Client $CdpClient
                $CdpClient = $null
            }
            if ($BrowserProcess) {
                Stop-ProcessTree -TargetProcessId $BrowserProcess.Id
                $BrowserProcess = $null
            }
        }
        $CaseResults.Add([pscustomobject]$case)
    }

    $failedCases = @($CaseResults | Where-Object { -not $_.passed })
    if ($failedCases.Count -gt 0) {
        throw "Interaction smoke found $($failedCases.Count) failing matrix case(s)."
    }
    $RunStatus = "passed"
} catch {
    $RunError = $_.Exception.Message
} finally {
    if ($CdpClient) {
        Close-CdpClient -Client $CdpClient
    }
    if ($BrowserProcess) {
        Stop-ProcessTree -TargetProcessId $BrowserProcess.Id
    }
    if ($DevServerProcessId) {
        Stop-ProcessTree -TargetProcessId $DevServerProcessId
    }
    if ($DevProcess) {
        Stop-ProcessTree -TargetProcessId $DevProcess.Id
    }
    $FinishedAt = Get-Date
    try {
        Write-Evidence -RunStatus $RunStatus -RunError $RunError -BrowserPath $BrowserPath -DevUrl $DevUrl -StartedAt $StartedAt -FinishedAt $FinishedAt
    } catch {
        if (-not $RunError) {
            $RunError = "Evidence write failed: $($_.Exception.Message)"
        }
    }
    if (Test-Path $BrowserUserDataRoot) {
        Remove-Item -LiteralPath $BrowserUserDataRoot -Recurse -Force -ErrorAction SilentlyContinue
    }
}

if ($RunError) {
    throw $RunError
}

[pscustomobject]@{
    Passed = $true
    Status = $RunStatus
    OutputJson = $JsonPath
    OutputMarkdown = $MarkdownPath
    MatrixCases = $CaseResults.Count
    Routes = $RouteResults.Count
    Quick = [bool]$Quick
} | Format-List
