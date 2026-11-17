from PIL import Image, ImageDraw
import sys
W,H=576,652
im=Image.new("RGB",(W,H),(255,0,255)); d=ImageDraw.Draw(im)
g=(150,150,155); o=(70,70,75)
def sh(f,*a,**k): f(*a,fill=g,outline=o,width=4,**k)
sh(d.ellipse,[235,60,365,190])            # head, round
sh(d.rounded_rectangle,[275,185,325,220],radius=8)  # neck
sh(d.rounded_rectangle,[215,215,385,420],radius=30) # torso
sh(d.rounded_rectangle,[170,225,225,400],radius=25) # back arm
sh(d.rounded_rectangle,[375,225,430,400],radius=25) # front arm
sh(d.rounded_rectangle,[225,410,375,470],radius=15) # hips
sh(d.rounded_rectangle,[230,460,295,640],radius=20) # legs
sh(d.rounded_rectangle,[305,460,370,640],radius=20)
sh(d.rounded_rectangle,[215,610,300,650],radius=14) # boots
sh(d.rounded_rectangle,[300,610,395,650],radius=14)
im.save(sys.argv[1])
