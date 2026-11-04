"""Test CloudFront viewer-request gate logic via Node.js execution.

This test extracts the pin_lock_function_code from Terraform main.tf,
replaces Terraform variable interpolation with actual boolean values,
and executes the CloudFront function via Node.js to verify behavior
across pin protection enabled/disabled states.
"""

import json
import os
import re
import subprocess
from pathlib import Path


def extract_tf_function(tf_file_path: str) -> str:
    """Extract the pin_lock_function_code heredoc from Terraform."""
    with open(tf_file_path, 'r') as f:
        content = f.read()
    
    # Find the pin_lock_function_code block (from <<-EOF to EOF)
    match = re.search(
        r'pin_lock_function_code\s*=\s*<<-EOF\n(.*?)\n\s*EOF',
        content,
        re.DOTALL
    )
    if not match:
        raise ValueError("Could not find pin_lock_function_code in Terraform file")
    
    return match.group(1)


def inject_pin_protection_value(function_code: str, enabled: bool) -> str:
    """Replace ${var.pin_protection_enabled} with true/false."""
    value = "true" if enabled else "false"
    return re.sub(
        r'\$\{var\.pin_protection_enabled\}',
        value,
        function_code
    )


def create_node_test_harness(function_code: str, test_cases: list) -> str:
    """Wrap the CloudFront function in a Node.js test harness.
    
    Args:
        function_code: The CloudFront handler function as a string
        test_cases: List of dicts with keys: uri, host, cookie, expect_status
    
    Returns:
        Complete Node.js script
    """
    test_json = json.dumps(test_cases)
    
    script = """const testCases = """ + test_json + """;

""" + function_code + """

const results = [];

for (const testCase of testCases) {
    const event = {
        request: {
            uri: testCase.uri || '/',
            headers: {
                host: { value: testCase.host || 'www.derschweigert.de' },
                cookie: testCase.cookie ? { value: testCase.cookie } : undefined
            },
            cookies: {}
        }
    };

    // Parse cookies into the cookies object
    if (testCase.cookie) {
        const cookieHeader = testCase.cookie;
        const parts = cookieHeader.split(';');
        for (const part of parts) {
            const [key, value] = part.trim().split('=');
            if (key) {
                event.request.cookies[key] = { value: value || '1' };
            }
        }
    }

    try {
        const result = handler(event);
        results.push({
            uri: testCase.uri,
            host: testCase.host,
            cookie: testCase.cookie,
            expectStatus: testCase.expect_status,
            resultStatus: result.statusCode || 200,
            resultDescription: result.statusDescription || 'OK',
            redirect: result.headers?.location?.value,
            requestUri: event.request.uri,
            pass: (result.statusCode || 200) === testCase.expect_status
        });
    } catch (error) {
        results.push({
            uri: testCase.uri,
            error: error.message,
            pass: false
        });
    }
}

console.log(JSON.stringify(results, null, 2));
"""
    return script


def run_node_test(script: str) -> list:
    """Execute the Node.js script and return parsed results."""
    result = subprocess.run(
        ['node', '-e', script],
        capture_output=True,
        text=True,
        check=False
    )
    
    if result.returncode != 0:
        raise RuntimeError(f"Node.js execution failed: {result.stderr}")
    
    try:
        return json.loads(result.stdout)
    except json.JSONDecodeError as e:
        raise RuntimeError(f"Failed to parse Node.js output: {result.stdout}\n{e}")


def test_cloudfront_gate_public_default_disabled():
    """Verify public homepage access when PIN protection is disabled (default)."""
    tf_file = Path(__file__).parents[2] / 'infra' / 'terraform' / 'sites' / 'derschweigert' / 'main.tf'
    tf_file = tf_file.resolve()
    
    # This seems like we're reading from a different location; let's use the relative path
    tf_file = Path(__file__).parent.parent.parent.parent / 'infra' / 'terraform' / 'sites' / 'derschweigert' / 'main.tf'
    
    function_code = extract_tf_function(str(tf_file))
    function_code = inject_pin_protection_value(function_code, False)
    
    test_cases = [
        {
            "uri": "/",
            "host": "www.derschweigert.de",
            "cookie": None,
            "expect_status": 200,
            "description": "Homepage public when disabled"
        },
        {
            "uri": "/services/websites",
            "host": "www.derschweigert.de",
            "cookie": None,
            "expect_status": 200,
            "description": "Internal page public when disabled"
        }
    ]
    
    script = create_node_test_harness(function_code, test_cases)
    results = run_node_test(script)
    
    for result in results:
        assert result['pass'], f"Test failed: {result.get('description')} - {result}"


def test_cloudfront_gate_requires_pin_when_enabled():
    """Verify homepage requires PIN cookie when protection is enabled."""
    tf_file = Path(__file__).parent.parent.parent.parent / 'infra' / 'terraform' / 'sites' / 'derschweigert' / 'main.tf'
    
    function_code = extract_tf_function(str(tf_file))
    function_code = inject_pin_protection_value(function_code, True)
    
    test_cases = [
        {
            "uri": "/",
            "host": "www.derschweigert.de",
            "cookie": None,
            "expect_status": 302,
            "description": "Homepage redirects without PIN when enabled"
        },
        {
            "uri": "/services/websites",
            "host": "www.derschweigert.de",
            "cookie": None,
            "expect_status": 302,
            "description": "Internal page redirects without PIN when enabled"
        }
    ]
    
    script = create_node_test_harness(function_code, test_cases)
    results = run_node_test(script)
    
    for result in results:
        assert result['pass'], f"Test failed: {result.get('description')} - {result}"


def test_cloudfront_gate_cookie_passes_when_enabled():
    """Verify valid PIN cookie bypasses gate when enabled."""
    tf_file = Path(__file__).parent.parent.parent.parent / 'infra' / 'terraform' / 'sites' / 'derschweigert' / 'main.tf'
    
    function_code = extract_tf_function(str(tf_file))
    function_code = inject_pin_protection_value(function_code, True)
    
    test_cases = [
        {
            "uri": "/",
            "host": "www.derschweigert.de",
            "cookie": "ams_pin=1",
            "expect_status": 200,
            "description": "Homepage passes with valid PIN cookie when enabled"
        },
        {
            "uri": "/services/websites",
            "host": "www.derschweigert.de",
            "cookie": "ams_pin=1",
            "expect_status": 200,
            "description": "Internal page passes with valid PIN cookie when enabled"
        }
    ]
    
    script = create_node_test_harness(function_code, test_cases)
    results = run_node_test(script)
    
    for result in results:
        assert result['pass'], f"Test failed: {result.get('description')} - {result}"


def test_cloudfront_gate_legal_pages_public_both_flags():
    """Verify legal pages are always accessible, regardless of PIN setting."""
    tf_file = Path(__file__).parent.parent.parent.parent / 'infra' / 'terraform' / 'sites' / 'derschweigert' / 'main.tf'
    
    for pin_enabled in [False, True]:
        function_code = extract_tf_function(str(tf_file))
        function_code = inject_pin_protection_value(function_code, pin_enabled)
        
        test_cases = [
            {
                "uri": "/impressum",
                "host": "www.derschweigert.de",
                "cookie": None,
                "expect_status": 200,
                "description": f"Impressum public when PIN {'enabled' if pin_enabled else 'disabled'}"
            },
            {
                "uri": "/datenschutz",
                "host": "www.derschweigert.de",
                "cookie": None,
                "expect_status": 200,
                "description": f"Datenschutz public when PIN {'enabled' if pin_enabled else 'disabled'}"
            },
            {
                "uri": "/nutzungsbedingungen",
                "host": "www.derschweigert.de",
                "cookie": None,
                "expect_status": 200,
                "description": f"Nutzungsbedingungen public when PIN {'enabled' if pin_enabled else 'disabled'}"
            }
        ]

        script = create_node_test_harness(function_code, test_cases)
        results = run_node_test(script)

        for result in results:
            assert result['pass'], f"Test failed: {result.get('description')} - {result}"
            if result["uri"] == "/nutzungsbedingungen":
                assert result.get("redirect") is None
                assert result["requestUri"] == "/nutzungsbedingungen.html"


def test_cloudfront_gate_contact_gone_both_flags():
    """Verify /contact routes return 410 Gone regardless of PIN setting."""
    tf_file = Path(__file__).parent.parent.parent.parent / 'infra' / 'terraform' / 'sites' / 'derschweigert' / 'main.tf'
    
    for pin_enabled in [False, True]:
        function_code = extract_tf_function(str(tf_file))
        function_code = inject_pin_protection_value(function_code, pin_enabled)
        
        test_cases = [
            {
                "uri": "/contact",
                "host": "www.derschweigert.de",
                "cookie": None,
                "expect_status": 410,
                "description": f"/contact returns 410 when PIN {'enabled' if pin_enabled else 'disabled'}"
            },
            {
                "uri": "/contact.html",
                "host": "www.derschweigert.de",
                "cookie": None,
                "expect_status": 410,
                "description": f"/contact.html returns 410 when PIN {'enabled' if pin_enabled else 'disabled'}"
            }
        ]
        
        script = create_node_test_harness(function_code, test_cases)
        results = run_node_test(script)
        
        for result in results:
            assert result['pass'], f"Test failed: {result.get('description')} - {result}"
