#!/usr/bin/env python3
# Physics verification of the EL-SYSTEMA JS core against scipy ground truth.
# Guarantees the geometry is physically correct (§6 of the master spec):
#   (1) membrane Bessel zeros alpha_mn   (A1 core)
#   (2) the besselJArray implementation  (Miller downward recurrence)
#   (3) plate eigenvalues lambda for clamped / simply-supported / free edges
#
# Usage:  python3 verify_physics.py         (needs scipy, numpy, and node)
# It reads the live JS tables via node, so it always checks the shipped values.
import json, subprocess, os, numpy as np
from scipy.special import jn_zeros, jv, jvp, iv, ivp
from scipy.optimize import brentq

HERE = os.path.dirname(os.path.abspath(__file__))
NU = 0.30  # Poisson ratio for the ss/free plate characteristic equations

def js(expr):
    out = subprocess.check_output(['node', '--input-type=module', '-e', expr], cwd=HERE)
    return json.loads(out)

tables = js("import {BESSEL_ZEROS} from './bessel.js';import {PLATE_LAMBDA} from './modal.js';"
            "console.log(JSON.stringify({BESSEL_ZEROS,PLATE_LAMBDA}))")
bj = js("import {besselJArray} from './bessel.js';const xs=[0.5,1,2.4048,3.8317,5,7.5,10,13.3,17.96,22.2178];"
        "const o={};for(const x of xs)o[x]=besselJArray(x,5);console.log(JSON.stringify(o))")

allok = True
def report(name, a, b, tol):
    global allok
    a, b = np.array(a, float), np.array(b, float)
    worst = np.abs(a-b).max(); ok = worst <= tol; allok &= ok
    print(f"[{'PASS' if ok else 'FAIL'}] {name:34s} max|Δ|={worst:.3e} (tol {tol})")

# (1) membrane alpha_mn = n-th zero of J_m
report("BESSEL_ZEROS (m0-5,n1-5)", tables['BESSEL_ZEROS'], [jn_zeros(m,5) for m in range(6)], 5e-4)

# (2) besselJArray vs scipy.jv
maxe = max(abs(v - jv(m, float(x))) for x, arr in bj.items() for m, v in enumerate(arr))
print(f"[{'PASS' if maxe<1e-6 else 'FAIL'}] besselJArray vs scipy.jv       max|Δ|={maxe:.3e} (tol 1e-6)"); allok &= maxe < 1e-6

# (3) plate eigenvalues (bounded solid-plate mode A*J_m(lr)+B*I_m(lr), edge r=1)
def clamped(m,l): return jvp(m,l)*iv(m,l) - jv(m,l)*ivp(m,l)
def ss(m,l):      return 2*l*jv(m,l)*iv(m,l) + (NU-1)*(jv(m,l)*ivp(m,l) - iv(m,l)*jvp(m,l))
def free(m,l):
    n=m
    def F(R,d1,d2,d3):
        Rp,Rpp,Rppp = l*d1, l*l*d2, l**3*d3
        Mr = Rpp + NU*(Rp - n*n*R)
        Pp = Rppp + Rpp - Rp - n*n*Rp + 2*n*n*R
        return Mr, Pp + (1-NU)*n*n*(R - Rp)
    Mj,Vj = F(jv(n,l),jvp(n,l,1),jvp(n,l,2),jvp(n,l,3))
    Mi,Vi = F(iv(n,l),ivp(n,l,1),ivp(n,l,2),ivp(n,l,3))
    return Mj*Vi - Mi*Vj
def roots(fn,m,cnt,skip):
    xs=np.arange(0.2,30,0.01); out=[]; p=fn(m,xs[0])
    for x in xs[1:]:
        c=fn(m,x)
        if np.isfinite(p) and np.isfinite(c) and p*c<0:
            try:
                r=brentq(lambda t:fn(m,t),x-0.01,x,xtol=1e-11)
                if r>skip+1e-6: out.append(r)
            except ValueError: pass
            if len(out)>=cnt: break
        p=c
    return out
for edge,fn,skip in [('clamped',clamped,0.0),('ss',ss,0.0),('free',free,1.0)]:
    ref=[roots(fn,m,4,skip) for m in range(6)]
    report(f"PLATE_LAMBDA['{edge}']", tables['PLATE_LAMBDA'][edge], ref, 0.05)

print("ALL PHYSICS CHECKS PASS" if allok else "SOME CHECKS FAILED")
