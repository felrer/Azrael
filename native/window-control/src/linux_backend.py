#!/usr/bin/python3
"""X11 selected-window capture and AT-SPI actions; JSON-lines native contract.

No desktop capture, pointer injection, clipboard or window activation fallback.
System GI/Pillow call compiled AT-SPI/X11/image libraries.
"""
import base64
import ctypes as C
import io
import json
import os
from pathlib import Path
import select
import sys
import threading
import time
import uuid

import gi
gi.require_version('Atspi', '2.0')
gi.require_version('Gtk', '3.0')
from gi.repository import Atspi, Gtk, Gdk, GLib
from PIL import Image


class Failure(Exception):
    def __init__(self, code, message):
        self.code, self.message = code, message


class Attributes(C.Structure):
    _fields_ = [('x', C.c_int), ('y', C.c_int), ('width', C.c_int), ('height', C.c_int),
               ('border_width', C.c_int), ('depth', C.c_int), ('visual', C.c_void_p),
               ('root', C.c_ulong), ('class_', C.c_int), ('bit_gravity', C.c_int),
               ('win_gravity', C.c_int), ('backing_store', C.c_int),
               ('backing_planes', C.c_ulong), ('backing_pixel', C.c_ulong),
               ('save_under', C.c_int), ('colormap', C.c_ulong),
               ('map_installed', C.c_int), ('map_state', C.c_int),
               ('all_event_masks', C.c_long), ('your_event_mask', C.c_long),
               ('do_not_propagate_mask', C.c_long), ('override_redirect', C.c_int),
               ('screen', C.c_void_p)]


class KeyEvent(C.Structure):
    _fields_ = [('type',C.c_int),('serial',C.c_ulong),('send_event',C.c_int),
                ('display',C.c_void_p),('window',C.c_ulong),('root',C.c_ulong),
                ('subwindow',C.c_ulong),('time',C.c_ulong),('x',C.c_int),('y',C.c_int),
                ('x_root',C.c_int),('y_root',C.c_int),('state',C.c_uint),
                ('keycode',C.c_uint),('same_screen',C.c_int)]


class Visual(C.Structure):
    _fields_ = [('ext_data',C.c_void_p),('visualid',C.c_ulong),('class_',C.c_int),
                ('red_mask',C.c_ulong),('green_mask',C.c_ulong),('blue_mask',C.c_ulong),
                ('bits_per_rgb',C.c_int),('map_entries',C.c_int)]


class XImage(C.Structure):
    _fields_ = [('width', C.c_int), ('height', C.c_int), ('xoffset', C.c_int),
               ('format', C.c_int), ('data', C.c_void_p), ('byte_order', C.c_int),
               ('bitmap_unit', C.c_int), ('bitmap_bit_order', C.c_int),
               ('bitmap_pad', C.c_int), ('depth', C.c_int), ('bytes_per_line', C.c_int),
               ('bits_per_pixel', C.c_int), ('red_mask', C.c_ulong),
               ('green_mask', C.c_ulong), ('blue_mask', C.c_ulong)]


class X11:
    def __init__(self):
        self.lib = C.CDLL('libX11.so.6')
        signatures = {
            'XOpenDisplay': (C.c_void_p, [C.c_char_p]),
            'XDefaultRootWindow': (C.c_ulong, [C.c_void_p]),
            'XInternAtom': (C.c_ulong, [C.c_void_p, C.c_char_p, C.c_int]),
            'XGetWindowProperty': (C.c_int, [C.c_void_p, C.c_ulong, C.c_ulong,
                C.c_long, C.c_long, C.c_int, C.c_ulong, C.POINTER(C.c_ulong),
                C.POINTER(C.c_int), C.POINTER(C.c_ulong), C.POINTER(C.c_ulong),
                C.POINTER(C.c_void_p)]),
            'XGetWindowAttributes': (C.c_int, [C.c_void_p, C.c_ulong, C.POINTER(Attributes)]),
            'XQueryTree': (C.c_int, [C.c_void_p, C.c_ulong, C.POINTER(C.c_ulong),
                C.POINTER(C.c_ulong), C.POINTER(C.POINTER(C.c_ulong)), C.POINTER(C.c_uint)]),
            'XTranslateCoordinates': (C.c_int, [C.c_void_p, C.c_ulong, C.c_ulong, C.c_int, C.c_int, C.POINTER(C.c_int), C.POINTER(C.c_int), C.POINTER(C.c_ulong)]),
            'XGetInputFocus': (C.c_int,[C.c_void_p,C.POINTER(C.c_ulong),C.POINTER(C.c_int)]),
            'XStringToKeysym': (C.c_ulong,[C.c_char_p]),
            'XKeysymToKeycode': (C.c_ubyte,[C.c_void_p,C.c_ulong]),
            'XSendEvent': (C.c_int,[C.c_void_p,C.c_ulong,C.c_int,C.c_long,C.c_void_p]),
            'XFree': (C.c_int, [C.c_void_p]),
            'XGetImage': (C.POINTER(XImage), [C.c_void_p, C.c_ulong, C.c_int,
                C.c_int, C.c_uint, C.c_uint, C.c_ulong, C.c_int]),
            'XDestroyImage': (C.c_int, [C.POINTER(XImage)]),
            'XFreePixmap': (C.c_int, [C.c_void_p, C.c_ulong]),
            'XResizeWindow': (C.c_int, [C.c_void_p, C.c_ulong, C.c_uint, C.c_uint]),
            'XMapWindow': (C.c_int, [C.c_void_p, C.c_ulong]),
            'XSync': (C.c_int, [C.c_void_p, C.c_int]),
            'XSelectInput': (C.c_int, [C.c_void_p, C.c_ulong, C.c_long]),
            'XPending': (C.c_int, [C.c_void_p]),
            'XNextEvent': (C.c_int, [C.c_void_p, C.c_void_p]),
        }
        for name, (ret, args) in signatures.items():
            f = getattr(self.lib, name); f.restype, f.argtypes = ret, args
        self.errors = []
        self.handler = C.CFUNCTYPE(C.c_int, C.c_void_p, C.c_void_p)(lambda d, e: self.errors.append(True) or 0)
        self.lib.XSetErrorHandler.argtypes = [type(self.handler)]
        self.lib.XSetErrorHandler(self.handler)
        self.d = self.lib.XOpenDisplay(None)
        if not self.d:
            raise Failure('capture-unsupported', 'A local X11 DISPLAY is required')
        self.root = self.lib.XDefaultRootWindow(self.d)
        self.dead = set()
        self.composite = C.CDLL('libXcomposite.so.1')
        self.composite.XCompositeNameWindowPixmap.restype = C.c_ulong
        self.composite.XCompositeNameWindowPixmap.argtypes = [C.c_void_p, C.c_ulong]

    def barrier(self):
        self.lib.XSync(self.d, 0)
        while self.lib.XPending(self.d):
            event = (C.c_long * 24)()
            self.lib.XNextEvent(self.d, event)
            # XDestroyWindowEvent: type, serial, send_event, display, event, window.
            if C.cast(event, C.POINTER(C.c_int))[0] == 17:
                self.dead.add(event[5])
        self.errors.clear()

    def prop(self, window, name):
        atom = self.lib.XInternAtom(self.d, name.encode(), 0)
        typ, fmt, count, left, data = C.c_ulong(), C.c_int(), C.c_ulong(), C.c_ulong(), C.c_void_p()
        self.lib.XGetWindowProperty(self.d, window, atom, 0, 65536, 0, 0,
            C.byref(typ), C.byref(fmt), C.byref(count), C.byref(left), C.byref(data))
        if not data.value:
            return []
        try:
            if fmt.value == 32:
                return list(C.cast(data, C.POINTER(C.c_ulong))[:count.value])
            return C.string_at(data, count.value).decode('utf-8', 'replace')
        finally:
            self.lib.XFree(data)

    def children(self, w):
        root, parent, values, count = C.c_ulong(), C.c_ulong(), C.POINTER(C.c_ulong)(), C.c_uint()
        if not self.lib.XQueryTree(self.d, w, C.byref(root), C.byref(parent), C.byref(values), C.byref(count)):
            return []
        try:
            return list(values[:count.value])
        finally:
            if values: self.lib.XFree(values)

    def window(self, xid):
        self.barrier()
        if xid in self.dead:
            raise Failure('window-closed', 'Selected XID was destroyed')
        a = Attributes()
        if not self.lib.XGetWindowAttributes(self.d, xid, C.byref(a)):
            raise Failure('window-closed', 'Selected window no longer exists')
        clients = self.prop(self.root, '_NET_CLIENT_LIST')
        if a.override_redirect or (clients and xid not in clients) or (not clients and xid not in self.children(self.root)):
            raise Failure('stale-target','Only top-level application windows are supported')
        pids = self.prop(xid, '_NET_WM_PID')
        if not pids:
            raise Failure('stale-target', 'Window has no verifiable process identity')
        pid = pids[0]
        if pid == os.getpid(): raise Failure('stale-target','Internal Window Use indicator is not a target')
        try:
            stat = Path(f'/proc/{pid}/stat').read_text().rsplit(')', 1)[1].split()
            started = int(stat[19])
            executable = os.readlink(f'/proc/{pid}/exe')
        except (OSError, ValueError, IndexError):
            raise Failure('stale-target', 'Window process cannot be verified')
        self.lib.XSelectInput(self.d, xid, 1 << 17)  # StructureNotifyMask
        return dict(hwnd=f'{xid:x}', pid=pid, processCreated=f'{started:x}',
                    executable=executable, title=self.prop(xid, '_NET_WM_NAME') or self.prop(xid, 'WM_NAME') or '',
                    minimized=a.map_state != 2, widthPx=a.width, heightPx=a.height, dpi=96)

    def verify(self, requested):
        if not isinstance(requested, dict): raise Failure('invalid-params', 'Window descriptor required')
        try: current = self.window(int(requested['hwnd'], 16))
        except (KeyError, TypeError, ValueError): raise Failure('invalid-params', 'Invalid window identity')
        if any(current[k] != requested.get(k) for k in ('hwnd', 'pid', 'processCreated', 'executable')):
            raise Failure('stale-target', 'Window process identity changed')
        return current

    def geometry(self, window):
        xid = int(window['hwnd'], 16)
        x, y, child = C.c_int(), C.c_int(), C.c_ulong()
        if not self.lib.XTranslateCoordinates(self.d,xid,self.root,0,0,C.byref(x),C.byref(y),C.byref(child)):
            raise Failure('stale-target','Cannot determine selected window geometry')
        return (x.value,y.value,window['widthPx'],window['heightPx'])

    def capture(self, window):
        xid = int(window['hwnd'], 16)
        w, h = window['widthPx'], window['heightPx']
        if w <= 0 or h <= 0 or w*h > 16_000_000:
            raise Failure('capture-size', 'Selected window exceeds capture bounds')
        pixmap = self.composite.XCompositeNameWindowPixmap(self.d, xid)
        self.lib.XSync(self.d, 0)
        # Unredirected Xvfb windows can be captured directly only when unobscured.
        # Production compositors supply an independent selected-window pixmap.
        if self.errors or not pixmap:
            self.errors.clear()
            raise Failure('capture-unsupported', 'XComposite redirected window capture unavailable')
        image = self.lib.XGetImage(self.d, pixmap, 0, 0, w, h, C.c_ulong(-1).value, 2)
        try:
            if not image: raise Failure('capture-format', 'Selected pixmap cannot be read')
            img = image.contents
            attributes = Attributes()
            if not self.lib.XGetWindowAttributes(self.d,xid,C.byref(attributes)) or not attributes.visual:
                raise Failure('window-closed','Selected window disappeared during capture')
            visual = C.cast(attributes.visual,C.POINTER(Visual)).contents
            if img.bits_per_pixel != 32 or img.byte_order != 0 or (visual.red_mask, visual.green_mask, visual.blue_mask) != (0xff0000, 0xff00, 0xff):
                raise Failure('capture-format', 'Unsupported selected-window pixel format')
            raw = C.string_at(img.data, img.bytes_per_line * h)
            rgb = Image.frombytes('RGB', (w, h), raw, 'raw', 'BGRX', img.bytes_per_line)
            out = io.BytesIO(); rgb.save(out, format='PNG')
            return base64.b64encode(out.getvalue()).decode()
        finally:
            if image: self.lib.XDestroyImage(image)
            self.lib.XFreePixmap(self.d, pixmap)


class Backend:
    def __init__(self):
        self.x = X11()
        Atspi.set_timeout(1500, 3000)
        self.observation = None
        self.overlay = None
        self.overlay_identity = None
        self.lock = threading.Lock()

    def accessible_root(self, w):
        # AT-SPI top-level frame match must be unique within the verified process.
        desktop = Atspi.get_desktop(0)
        matches = []
        geometry = self.x.geometry(w)
        borders = self.x.prop(int(w['hwnd'],16), '_NET_FRAME_EXTENTS')
        acceptable = [geometry]
        if len(borders) == 4:
            x,y,width,height = geometry; left,right,top,bottom = borders
            acceptable.append((x-left,y-top,width+left+right,height+top+bottom))
        if desktop:
            for i in range(min(desktop.get_child_count(), 2048)):
                app = desktop.get_child_at_index(i)
                if app.get_process_id() != w['pid']: continue
                for j in range(min(app.get_child_count(), 2048)):
                    frame = app.get_child_at_index(j)
                    component = frame.get_component_iface()
                    if frame.get_name() == w['title'] and component:
                        rect = component.get_extents(Atspi.CoordType.SCREEN)
                        if (rect.x,rect.y,rect.width,rect.height) in acceptable:
                            matches.append(frame)
        if len(matches) > 1:
            raise Failure('stale-element', 'Accessible window mapping is ambiguous')
        return matches[0] if matches else None

    def elements(self, w, request=None, container=None):
        request = request or dict(mode='task')
        legacy = request.get('mode') == 'task'
        limit = 2048 if legacy else request.get('limit', 20)
        root = self.accessible_root(w)
        if root is None:
            return [], {}, 'accessibility-unavailable'
        pending, descriptors, refs = [(container or root, None, 0)], [], {}
        scanned, reason, started = 0, None, time.monotonic()
        while pending:
            if not legacy and time.monotonic()-started >= 1.5: reason = 'time-limit'; break
            if scanned >= 2048: reason = 'scan-limit'; break
            element, parent, depth = pending.pop(0)
            if element.get_process_id() != w['pid']: continue
            scanned += 1
            eid = f'element-{scanned}'
            password = element.get_role() == Atspi.Role.PASSWORD_TEXT
            name = '' if password else element.get_name() or ''
            role = element.get_role_name() or 'unknown'
            query = request.get('query') or {}
            nq = query.get('name') or {}
            aid = (element.get_attributes() or {}).get('id', '') if 'automationId' in query else ''
            matches = (('equals' not in nq or nq['equals'] == name) and ('contains' not in nq or nq['contains'] in name)
                       and ('automationId' not in query or query['automationId'] == aid)
                       and ('controlType' not in query or query['controlType'] == role))
            if matches and len(descriptors) == limit: reason = 'output-limit'; break
            if not legacy:
                if matches:
                    state = element.get_state_set()
                    d = dict(id=eid,name=name[:160],controlType=role,isPassword=password,enabled=state.contains(Atspi.StateType.ENABLED))
                    descriptors.append(d); refs[eid] = (element,d,root)
                count = element.get_child_count()
                if count and depth+1 >= 128: reason = 'depth-limit'; continue
                room = 2048-scanned-len(pending)
                for i in range(min(count,room)):
                    if time.monotonic()-started >= 1.5: reason = 'time-limit'; break
                    pending.append((element.get_child_at_index(i),eid,depth+1))
                if count > room: reason = 'scan-limit'
                continue
            patterns = []
            actions = element.get_action_iface()
            names = [actions.get_action_name(i).lower() for i in range(actions.get_n_actions())] if actions else []
            if any(n in ('click', 'activate', 'press', 'invoke') for n in names): patterns.append('invoke')
            if 'toggle' in names or element.get_role() == Atspi.Role.CHECK_BOX: patterns.append('toggle')
            state = element.get_state_set()
            editable = element.get_editable_text_iface()
            if editable and state.contains(Atspi.StateType.EDITABLE): patterns.append('setValue')
            if state.contains(Atspi.StateType.SELECTABLE): patterns.append('select')
            if element.get_role() == Atspi.Role.SCROLL_BAR and element.get_value_iface(): patterns.append('scroll')
            if state.contains(Atspi.StateType.FOCUSED): patterns.append('pressKey')
            for n in ('expand', 'collapse'):
                if n in names: patterns.append(n)
            password = element.get_role() == Atspi.Role.PASSWORD_TEXT
            d = dict(id=eid, name='' if password else element.get_name() or '', controlType=element.get_role_name() or 'unknown',
                     patterns=patterns, parentId=parent, enabled=state.contains(Atspi.StateType.ENABLED), isPassword=password)
            if 'toggle' in patterns: d['toggleState'] = 'on' if state.contains(Atspi.StateType.CHECKED) else 'off'
            if state.contains(Atspi.StateType.SELECTABLE): d['selected'] = state.contains(Atspi.StateType.SELECTED)
            text = element.get_text_iface()
            if text and not password:
                if text.get_character_count() > 65536: raise Failure('uia-value-limit', 'Accessibility text exceeds bounds')
                d['value'] = Atspi.Text.get_text(text, 0, -1)
            descriptors.append(d); refs[eid] = (element, d, root)
            if depth < 128:
                for i in range(min(element.get_child_count(), 2048-len(pending))):
                    pending.append((element.get_child_at_index(i), eid, depth+1))
        return descriptors, refs, reason or ('scan-limit' if pending else None)

    def retained_element(self, w, observation, eid):
        ref = observation[2].get(eid)
        if not ref: raise Failure('unknown-element', 'Element not retained')
        element, _, root = ref
        current = element
        for _ in range(256):
            if current == root: break
            current = current.get_parent()
            if current is None: raise Failure('stale-element', 'Element left selected frame')
        else: raise Failure('stale-element', 'Ancestry exceeds bounds')
        if element.get_process_id() != w['pid'] or self.accessible_root(w) != root:
            raise Failure('stale-element', 'Accessible target changed')
        return element

    def read_element(self, w, p, observation):
        e = self.retained_element(w,observation,p.get('elementId'))
        password = e.get_role() == Atspi.Role.PASSWORD_TEXT
        d = dict(id=p['elementId'],isPassword=password)
        for f in p.get('fields', ['name','controlType','enabled']):
            if f in ('value','text'):
                if password: d[f]=None; d['redacted']=True; continue
                text=e.get_text_iface()
                if not text: raise Failure('unsupported-action','Text interface unavailable')
                r=p.get('textRange')
                if f=='text' and not r: raise Failure('invalid-params','Text requires textRange')
                start,length=(r['start'],r['length']) if f=='text' else (0,4096)
                count=text.get_character_count()
                d[f]=Atspi.Text.get_text(text,min(start,count),min(start+length,count))
                d['textRange']=dict(start=min(start,count),length=len(d[f]),omittedContent=start>0 or start+length<count,revision=p['observationId'])
            elif f=='name': d[f]='' if password else (e.get_name() or '')[:160]
            elif f=='controlType': d[f]=e.get_role_name() or 'unknown'
            elif f=='automationId': d[f]=(e.get_attributes() or {}).get('id','')[:160]
            elif f=='enabled': d[f]=e.get_state_set().contains(Atspi.StateType.ENABLED)
            elif f=='isPassword': d[f]=password
            elif f=='selected': d[f]=e.get_state_set().contains(Atspi.StateType.SELECTED)
            elif f=='toggleState': d[f]='on' if e.get_state_set().contains(Atspi.StateType.CHECKED) else 'off'
            elif f=='expandState': d[f]='expanded' if e.get_state_set().contains(Atspi.StateType.EXPANDED) else 'collapsed'
            elif f=='patterns':
                iface=e.get_action_iface()
                names=[iface.get_action_name(i).lower() for i in range(min(iface.get_n_actions(),100))] if iface else []
                d[f]=[n for n in ('toggle','expand','collapse') if n in names]
                if any(n in names for n in ('click','activate','press','invoke')): d[f].append('invoke')
                if e.get_role() == Atspi.Role.CHECK_BOX and 'toggle' not in d[f]: d[f].append('toggle')
                if e.get_editable_text_iface() and e.get_state_set().contains(Atspi.StateType.EDITABLE): d[f].append('setValue')
                if e.get_state_set().contains(Atspi.StateType.SELECTABLE): d[f].append('select')
            else: raise Failure('invalid-params','Unsupported inspection field')
        return d

    def act(self, p, w):
        observation, self.observation = self.observation, None
        if not observation or observation[0] != p.get('observationId') or observation[1] != {k:w[k] for k in ('hwnd','pid','processCreated','executable')}:
            raise Failure('stale-observation', 'A fresh observation for this window is required')
        if observation[3] != self.x.geometry(w):
            raise Failure('stale-observation','Window geometry changed since observation')
        ref = observation[2].get(p.get('elementId'))
        if not ref: raise Failure('unknown-element', 'Element not in latest observation')
        e, descriptor, root = ref
        current = e
        for _ in range(256):
            if current == root: break
            current = current.get_parent()
            if current is None: raise Failure('stale-element', 'Element no longer belongs to selected frame')
        else: raise Failure('stale-element', 'Accessible ancestry exceeded bound')
        if self.accessible_root(w) != root or e.get_process_id() != w['pid']:
            raise Failure('stale-element', 'Accessible target changed')
        action = p.get('action')
        patterns = self.read_element(w,dict(elementId=p.get('elementId'),fields=['patterns']),observation)['patterns']
        if e.get_state_set().contains(Atspi.StateType.FOCUSED): patterns.append('pressKey')
        if e.get_role() == Atspi.Role.SCROLL_BAR and e.get_value_iface(): patterns.append('scroll')
        if action not in patterns: raise Failure('unsupported-action', 'Selected element does not expose this action')
        if not e.get_state_set().contains(Atspi.StateType.ENABLED): raise Failure('disabled-element', 'Element disabled')
        self.x.verify(w)
        if action == 'setValue':
            value = p.get('value')
            if not isinstance(value, str) or len(value.encode('utf-8')) > 65536 or '\x00' in value: raise Failure('invalid-params', 'setValue requires bounded text')
            ok = e.get_editable_text_iface().set_text_contents(value)
        elif action == 'pressKey':
            key = p.get('value')
            if key not in ('Return','Tab','Escape','BackSpace','Delete','Left','Right','Up','Down','Home','End','PageUp','PageDown','space'):
                raise Failure('unsupported-key','Only fixed named keys are supported')
            if not e.get_state_set().contains(Atspi.StateType.FOCUSED):
                raise Failure('unsupported-action','Window-directed keys require the exact already-focused element')
            focus,revert=C.c_ulong(),C.c_int()
            self.x.lib.XGetInputFocus(self.x.d,C.byref(focus),C.byref(revert))
            current = focus.value
            for _ in range(128):
                if current == int(w['hwnd'],16): break
                root_x,parent,children,count=C.c_ulong(),C.c_ulong(),C.POINTER(C.c_ulong)(),C.c_uint()
                if not self.x.lib.XQueryTree(self.x.d,current,C.byref(root_x),C.byref(parent),C.byref(children),C.byref(count)):
                    raise Failure('unsupported-action','Selected window does not own keyboard focus')
                if children: self.x.lib.XFree(children)
                current=parent.value
                if current in (0,self.x.root): raise Failure('unsupported-action','Selected window does not own keyboard focus')
            else: raise Failure('unsupported-action','Keyboard target ancestry exceeds bound')
            if key == 'Return':
                iface=e.get_action_iface()
                names=[iface.get_action_name(i).lower() for i in range(iface.get_n_actions())] if iface else []
                if 'activate' in names:
                    if not iface.do_action(names.index('activate')):
                        raise Failure('uncertain-delivery','Accessibility activation not confirmed')
                    return dict(window=self.x.verify(w),acted=True,requiresObservation=True,delivery='accessibilityAction',verified=True,experimental=False)
            code=self.x.lib.XKeysymToKeycode(self.x.d,self.x.lib.XStringToKeysym(key.encode()))
            if not code: raise Failure('unsupported-key','Named key is unavailable in current keymap')
            for kind,mask in ((2,1),(3,2)):
                event=KeyEvent(type=kind,display=self.x.d,window=focus.value,root=self.x.root,keycode=code,same_screen=1)
                if not self.x.lib.XSendEvent(self.x.d,focus.value,0,mask,C.byref(event)):
                    raise Failure('uncertain-delivery','Window-directed key delivery failed')
            self.x.barrier()
            return dict(window=self.x.verify(w),acted=True,requiresObservation=True,delivery='windowMessage',verified=False,experimental=True)
        elif action == 'scroll':
            amounts=p.get('value')
            if not isinstance(amounts,dict) or set(amounts) != {'horizontal','vertical'} or any(type(v) is not int or v not in (-2,-1,0,1,2) for v in amounts.values()):
                raise Failure('invalid-params','Scroll requires bounded horizontal/vertical amounts')
            states=e.get_state_set(); axis='horizontal' if states.contains(Atspi.StateType.HORIZONTAL) else 'vertical'
            if amounts['vertical' if axis=='horizontal' else 'horizontal']:
                raise Failure('unsupported-action','Scrollbar does not support that axis')
            value=e.get_value_iface(); amount=amounts[axis]
            minimum,maximum=value.get_minimum_value(),value.get_maximum_value()
            step=max(value.get_minimum_increment(),(maximum-minimum)/100)
            if abs(amount)==2: step=max(step,(maximum-minimum)/5)
            desired=max(minimum,min(maximum,value.get_current_value()+(step if amount>0 else -step if amount<0 else 0)))
            ok=value.set_current_value(desired)
        elif action == 'select':
            parent = e.get_parent(); selection = parent.get_selection_iface()
            if not selection: raise Failure('unsupported-action', 'No selection interface')
            ok = selection.select_child(e.get_index_in_parent())
        else:
            iface = e.get_action_iface()
            names = [iface.get_action_name(i).lower() for i in range(iface.get_n_actions())] if iface else []
            accepted = {'invoke': ('click','activate','press','invoke'), 'toggle': ('toggle','click','activate'), 'expand': ('expand',), 'collapse': ('collapse',)}[action]
            indexes = [i for i,n in enumerate(names) if n in accepted]
            if not indexes: raise Failure('unsupported-action', 'No matching accessibility action')
            ok = iface.do_action(indexes[0])
        if not ok: raise Failure('uncertain-delivery', 'Accessibility provider did not confirm delivery')
        return dict(window=self.x.verify(w), acted=True, requiresObservation=True)

    def call(self, method, p):
        if method == 'listWindows':
            ids = self.x.prop(self.x.root, '_NET_CLIENT_LIST') or self.x.children(self.x.root)
            windows = []
            for xid in ids:
                try: windows.append(self.x.window(xid))
                except Failure: pass
            return dict(windows=windows)
        if method == 'shutdown': return dict(shutdown=True)
        if method == 'overlayHide':
            if self.overlay_identity == (p.get('targetId'),p.get('generation')):
                if self.overlay: GLib.idle_add(self.overlay.destroy); self.overlay = None
                self.overlay_identity = None
            return dict(hidden=True)
        w = self.x.verify(p.get('window'))
        if method == 'status': return dict(window=w)
        if method == 'overlayShow':
            ready = threading.Event(); outcome = {}
            def show():
                if self.overlay_identity and self.overlay_identity[0] == p.get('targetId') and self.overlay_identity[1] > p.get('generation',-1):
                    outcome.update(visible=True,hotkeyRegistered=False); ready.set(); return False
                if self.overlay: self.overlay.destroy()
                overlay = Gtk.Window(type=Gtk.WindowType.POPUP)
                overlay.set_accept_focus(False); overlay.set_keep_above(True)
                button = Gtk.Button(label='Azrael · '+str(p.get('label', 'Window Use'))+' · 중지')
                def stop(*args):
                    emit(dict(event=dict(type='overlayStop',targetId=p['targetId'],generation=p['generation'])))
                    overlay.destroy()
                button.connect('clicked', stop)
                overlay.add(button); overlay.show_all(); self.overlay = overlay; self.overlay_identity = (p['targetId'],p['generation'])
                # Indicator is a separate non-focusing control, never input to target.
                outcome.update(visible=True, hotkeyRegistered=False); ready.set()
                return False
            GLib.idle_add(show)
            if not ready.wait(3): raise Failure('backend-timeout', 'Overlay display timed out')
            return outcome
        if method == 'restore':
            self.observation = None; self.x.lib.XMapWindow(self.x.d, int(w['hwnd'],16)); self.x.barrier()
            return dict(window=self.x.verify(w), restored=True, requiresObservation=True)
        if w['minimized']: raise Failure('window-minimized', 'Selected window is minimized')
        if method == 'resize':
            width, height = p.get('widthDip'), p.get('heightDip')
            if any(not isinstance(v,(float,int)) or isinstance(v,bool) or not 1 <= v <= 16384 for v in (width,height)):
                raise Failure('resize-bounds', 'Window dimensions outside bounds')
            self.observation = None
            self.x.lib.XResizeWindow(self.x.d,int(w['hwnd'],16),round(width),round(height)); self.x.barrier()
            return dict(window=self.x.verify(w), resized=True, requiresObservation=True)
        if method == 'act': return self.act(p,w)
        if method in ('observe','inspect'):
            initial_geometry = self.x.geometry(w)
            previous, self.observation = self.observation, None
            identity = {k:w[k] for k in ('hwnd','pid','processCreated','executable')}
            prior = previous if previous and previous[1] == identity and previous[3] == initial_geometry else None
            exact = prior if prior and prior[0] == p.get('observationId') else None
            mode, limit = p.get('mode','summary'), p.get('limit',20)
            if mode not in ('summary','find','read','changes','task') or type(limit) is not int or not 1 <= limit <= 100:
                raise Failure('invalid-params','Invalid inspection mode or limit')
            query = p.get('query') or {}
            scope = p.get('scope') or {}
            if not isinstance(query,dict) or set(query)-{'name','automationId','controlType'} or not isinstance(scope,dict) or set(scope)-{'containerId'}:
                raise Failure('invalid-params','Invalid query or scope')
            nq = query.get('name') or {}
            if not isinstance(nq,dict) or set(nq)-{'equals','contains'}:
                raise Failure('invalid-params','Invalid name query')
            for value in list(nq.values())+[v for k,v in query.items() if k!='name']+list(scope.values()):
                if not isinstance(value,str) or len(value)>512 or '\0' in value:
                    raise Failure('invalid-params','Query exceeds supported bounds')
            r = p.get('textRange')
            if r is not None and (not isinstance(r,dict) or set(r) != {'start','length'} or type(r['start']) is not int or
                    type(r['length']) is not int or not 1 <= r['length'] <= 4096 or not 0 <= r['start'] <= 2147483647-r['length']):
                raise Failure('invalid-params','Invalid text range')
            fields = p.get('fields',[])
            if not isinstance(fields,list) or len(fields)>12 or any(not isinstance(f,str) or f not in
                    ('name','controlType','automationId','enabled','isPassword','value','text','patterns','selected','toggleState','expandState') for f in fields):
                raise Failure('invalid-params','Unsupported inspection field')
            if mode=='read' and 'text' in fields and r is None: raise Failure('invalid-params','Text requires textRange')
            signature = dict(query=p.get('query'),scope=p.get('scope'),limit=limit)
            changes = None
            if method == 'observe':
                descriptors, refs, reason = [], {}, None
                metadata = dict(mode='image',coverage='image-only',returnedCount=0)
            elif mode == 'read':
                if not exact: raise Failure('stale-observation','Read requires exact retained observation')
                descriptors,refs,reason = [self.read_element(w,p,exact)],exact[2],None
                metadata = dict(mode=mode,coverage='requested-fields',returnedCount=1)
            else:
                compatible_base = prior and prior[0] == p.get('baseObservationId') and len(prior)>4 and prior[4] == signature
                scan_request = p
                if mode == 'changes' and not compatible_base:
                    scan_request = dict(mode='summary',limit=20)
                    signature = dict(query=None,scope=None,limit=20)
                container_id = (p.get('scope') or {}).get('containerId')
                if mode == 'changes' and not compatible_base: container_id = None
                container = None
                if container_id:
                    if not exact: raise Failure('stale-observation','Scope requires exact retained observation')
                    container = self.retained_element(w,exact,container_id)
                descriptors,refs,reason = self.elements(w,scan_request,container)
                metadata = dict(mode=mode,coverage='partial' if reason else 'complete',returnedCount=len(descriptors),incompleteReason=reason)
                if mode == 'changes':
                    if compatible_base:
                        matched,updated,remapped = set(),[],{}
                        for d in descriptors:
                            e,_,root = refs[d['id']]
                            old = next((oid for oid,ref in prior[2].items() if ref[0] == e),None)
                            d['id'] = old or 'new-'+uuid.uuid4().hex
                            if old: matched.add(old)
                            if not old or prior[2][old][1] != d: updated.append(d)
                            remapped[d['id']] = (e,d,root)
                        refs = remapped
                        complete = not reason and prior[5]=='complete'
                        removed = [oid for oid in prior[2] if oid not in matched] if complete else []
                        changes = dict(updated=updated,removed=removed,removalsComplete=complete,basis='fresh-provider-scan')
                    else: metadata.update(fallback='summary',fallbackReason='base-unavailable-or-incompatible')
            after = self.x.verify(w)
            geometry = self.x.geometry(after)
            if initial_geometry != geometry or (w['widthPx'],w['heightPx']) != (after['widthPx'],after['heightPx']):
                raise Failure('capture-size-changed','Window geometry changed during inspection')
            oid = 'observation-'+uuid.uuid4().hex
            if method=='inspect' and mode=='read' and 'textRange' in descriptors[0]: descriptors[0]['textRange']['revision']=oid
            result = dict(window=w, observationId=oid, elements=descriptors, elementsTruncated=bool(reason),retrieval=metadata,changes=changes)
            if method == 'observe':
                data = self.x.capture(w)
                after = self.x.verify(w)
                if any(w[k] != after[k] for k in ('widthPx','heightPx','minimized')):
                    raise Failure('capture-size-changed', 'Window geometry changed during capture')
                result.update(frameTimestamp=str(time.monotonic_ns()),widthPx=w['widthPx'],heightPx=w['heightPx'],dpi=96,
                              image=dict(mimeType='image/png',data=data))
            if method=='inspect':
                if mode=='read': refs={p['elementId']: (exact[2][p['elementId']][0],descriptors[0],exact[2][p['elementId']][2])}; signature=None
                self.observation = (oid,identity,refs,geometry,signature,metadata['coverage'])
            return result
        raise Failure('unknown-method','Unknown native backend method')


output_lock = threading.Lock()
def emit(value):
    with output_lock:
        sys.stdout.write(json.dumps(value,ensure_ascii=False)+'\n'); sys.stdout.flush()


def main():
    backend = None
    # GTK runs its own event loop solely for the visible Stop indicator.
    def gtk_loop():
        Gtk.init([]); Gtk.main()
    threading.Thread(target=gtk_loop, daemon=True).start()
    while True:
        line = sys.stdin.buffer.readline(16*1024*1024+1)
        if not line: break
        rid = None
        try:
            if len(line) > 16*1024*1024:
                while line and not line.endswith(b'\n'): line = sys.stdin.buffer.readline(65536)
                raise Failure('request-too-large','Request exceeds 16 MiB')
            request = json.loads(line); rid = request.get('id')
            if set(request)-{'id','method','params'} or not isinstance(rid,(str,int)) or isinstance(rid,bool):
                raise Failure('invalid-request','Invalid request envelope')
            method, params = request['method'], request.get('params') or {}
            if method == 'shutdown': emit(dict(id=rid,result=dict(shutdown=True))); break
            if backend is None: backend = Backend()
            emit(dict(id=rid,result=backend.call(method,params)))
        except Failure as error:
            emit(dict(id=rid,error=dict(code=error.code,message=error.message)))
        except Exception:
            # Do not print element contents, input or screenshots in diagnostic logs.
            emit(dict(id=rid,error=dict(code='native-error',message='Linux window provider operation failed')))


if __name__ == '__main__': main()
