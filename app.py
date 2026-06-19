import os
import xml.etree.ElementTree as ET
import urllib.request
import time
from flask import Flask, jsonify, render_template, request

app = Flask(__name__)

# Simple in-memory cache
cache = {
    'data': None,
    'last_updated': 0
}
CACHE_DURATION = 300  # Cache for 5 minutes

def parse_release_notes(xml_content):
    root = ET.fromstring(xml_content)
    # The default namespace for Atom feeds
    ns = {'atom': 'http://www.w3.org/2005/Atom'}
    entries = []
    
    for entry in root.findall('atom:entry', ns):
        title_el = entry.find('atom:title', ns)
        updated_el = entry.find('atom:updated', ns)
        link_el = entry.find('atom:link[@rel="alternate"]', ns)
        if link_el is None:
            link_el = entry.find('atom:link', ns)
        content_el = entry.find('atom:content', ns)
        
        title = title_el.text if title_el is not None else ''
        updated = updated_el.text if updated_el is not None else ''
        link = link_el.attrib.get('href', '') if link_el is not None else ''
        content = content_el.text if content_el is not None else ''
        
        entries.append({
            'title': title,
            'updated': updated,
            'link': link,
            'content': content
        })
    return entries

def get_release_notes(force_refresh=False):
    now = time.time()
    if force_refresh or not cache['data'] or (now - cache['last_updated'] > CACHE_DURATION):
        try:
            req = urllib.request.Request(
                'https://docs.cloud.google.com/feeds/bigquery-release-notes.xml',
                headers={'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)'}
            )
            with urllib.request.urlopen(req, timeout=15) as response:
                xml_content = response.read()
            
            entries = parse_release_notes(xml_content)
            cache['data'] = entries
            cache['last_updated'] = now
            return entries, True
        except Exception as e:
            # Fallback to cache if request fails
            if cache['data']:
                return cache['data'], False
            raise e
    return cache['data'], False

@app.route('/')
def index():
    return render_template('index.html')

@app.route('/api/release-notes')
def release_notes_api():
    force_refresh = request.args.get('refresh', 'false').lower() == 'true'
    try:
        notes, fetched_fresh = get_release_notes(force_refresh=force_refresh)
        return jsonify({
            'success': True,
            'notes': notes,
            'fetched_fresh': fetched_fresh,
            'last_updated': time.strftime('%Y-%m-%d %H:%M:%S', time.localtime(cache['last_updated']))
        })
    except Exception as e:
        return jsonify({
            'success': False,
            'error': str(e)
        }), 500

if __name__ == '__main__':
    # Default port for development
    app.run(host='0.0.0.0', port=5000, debug=True)
