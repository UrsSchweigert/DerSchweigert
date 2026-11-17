import sys
sys.path.insert(0,"sites/ffm/scripts")
from pathlib import Path
import numpy as np
from PIL import Image
import hero_frames as hf
a=hf.load_atlas_frame(hf.STYLE_DEFAULT_DIR)
alpha=a[...,3]>0
# remove the blade and cape region crudely: keep only left ~ body; just flatten to grey
out=np.zeros_like(a); out[alpha]=(150,150,155,255)
# darker outline
from scipy import ndimage as nd
edge=alpha & ~nd.binary_erosion(alpha)
out[edge]=(70,70,75,255)
im=Image.fromarray(out,"RGBA"); z=hf.PLATE_ZOOM
big=im.resize((im.width*z,im.height*z),Image.NEAREST)
p=Image.new("RGBA",big.size,(*hf.PLATE_COLOUR,255)); p.alpha_composite(big)
p.convert("RGB").save(sys.argv[1])
