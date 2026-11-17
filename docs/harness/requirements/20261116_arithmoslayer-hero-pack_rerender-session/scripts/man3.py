from PIL import Image, ImageDraw
import sys
W,H=576,652
im=Image.new("RGB",(W,H),(255,0,255)); d=ImageDraw.Draw(im)
g=(150,150,155); o=(70,70,75)
def sh(f,*a,**k): f(*a,fill=g,outline=o,width=4,**k)
sh(d.ellipse,[250,60,370,185])
sh(d.polygon,[(355,120),(385,135),(355,150)])      # nose/face forward
sh(d.rounded_rectangle,[275,180,335,225],radius=8)
sh(d.rounded_rectangle,[240,215,355,420],radius=30)  # narrow side torso
sh(d.rounded_rectangle,[260,410,350,470],radius=15)
sh(d.rounded_rectangle,[255,460,310,640],radius=18)  # back leg
sh(d.rounded_rectangle,[300,460,355,640],radius=18)  # front leg
sh(d.rounded_rectangle,[235,610,305,650],radius=12)
sh(d.polygon,[(300,612),(395,625),(395,650),(300,650)])  # boot toe forward
sh(d.rounded_rectangle,[280,230,335,380],radius=22)  # arm
sh(d.rounded_rectangle,[320,360,360,410],radius=14)  # hand
im.save(sys.argv[1])
