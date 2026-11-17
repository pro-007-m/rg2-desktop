"""Build a reviewable JS adaptation of the pinned, separately licensed RCube source."""
from pathlib import Path
import argparse
import re

HERE=Path(__file__).resolve().parent
parser=argparse.ArgumentParser()
parser.add_argument('--source',type=Path,default=HERE/'upstream/RCube/Cube.cpp')
parser.add_argument('--destination',type=Path,default=HERE/'rcube.mjs')
parser.add_argument('--core-import',default='../../core.mjs')
args=parser.parse_args()
source=args.source.read_text(encoding='utf-8-sig')
source=re.sub(r'/\*.*?\*/','',source,flags=re.S)
source=re.sub(r'//[^\n]*','',source)
keep={'Solve','SolveCenters','AlignTrueCenters','IsOpposite','PushCenterPieces','FindCommutatorMap',
      'SolveEdgesOdd','SolveEdgesEven','FlipRightEdge','UnFlipRightEdge','FlipLeftEdge','UnFlipLeftEdge',
      'MoveCenterEdge','GetLeftEdgeColors','GetRightEdgeColors','FixParity','SetDestinationEdge',
      'SetSourceEdge','UpdateEdgeRotation','SolveCorners','FlipCorners','GetCorner','IsCorner','FindCorner'}
methods=[]
for match in re.finditer(r'\b(void|bool|int)\s+Cube::(\w+)\(([^)]*)\)\s*\{',source):
    name=match[2]
    if name not in keep: continue
    pos=match.end();depth=1
    while depth:
        if source[pos]=='{':depth+=1
        elif source[pos]=='}':depth-=1
        pos+=1
    body=source[match.end():pos-1]
    params=[re.search(r'(\w+)\s*$',p)[1] for p in match[3].split(',') if p.strip()]
    body=body.replace('this->','this.')
    body=re.sub(r'\bprintf\([^;]*;', '',body)
    body=re.sub(r'\bdelete\[\]\s+\w+\s*;', '',body)
    body=re.sub(r'\((?:uint64|uint|int|byte|double)\)', '',body)
    body=re.sub(r'new\s+uint\[([^\]]+)\]',r'new Uint32Array(\1)',body)
    body=re.sub(r'\b(?:int|byte|bool|uint)\s+(\w+)\[(\d+)\]\s*;',r'let \1 = new Array(\2).fill(0);',body)
    body=re.sub(r'\b(?:const\s+)?(?:uint64|uint|int|byte|bool|double)\s*\*?\s+(\w+)',r'let \1',body)
    body=re.sub(r'\b(Get(?:Left|Right)EdgeColors)\(([^,\n]+),\s*(\w+),\s*(\w+)\);',r'[\3,\4]=\1(\2);',body)
    body=re.sub(r'\bGetCorner\(([^,\n]+),\s*(\w+),\s*(\w+),\s*(\w+)\);',r'[\2,\3,\4]=GetCorner(\1);',body)
    if name=='GetCorner':body=re.sub(r'\breturn\s*;',r'return [c0,c1,c2];',body)
    if name=='GetLeftEdgeColors':body+='\nreturn [l0,l1];\n'
    if name=='GetRightEdgeColors':body+='\nreturn [r0,r1];\n'
    body=re.sub(r'\bmemset\(EdgeState,\s*0,\s*12\);','this.EdgeState.fill(false);',body)
    for member in ['R1','Mid','RowSize','Stage','QState','Itteration','SaveEnabled','MoveCount','Hours','ProcessStartTime','EdgeState','faces']:
        body=re.sub(r'(?<![.\w])'+member+r'\b','this.'+member,body)
    for method in sorted(keep|{'Move','SaveCubeState','CurrentProcessDuration','OptomizedMovement','IsCubeSolved'},key=len,reverse=True):
        body=re.sub(r'(?<![.\w])'+method+r'\s*\(', 'this.'+method+'(',body)
    body=body.replace('std::chrono::high_resolution_clock::now()','performance.now()')
    body=re.sub(r'\babs\s*\(', 'Math.abs(',body)
    body=re.sub(r'\n\s*\n\s*\n','\n\n',body)
    methods.append(f'  {name}({",".join(params)}) {{\n{body}\n  }}\n')

constants=[]
for name in ['EdgeColorMap','cmap','corners','EdgeRotMap']:
    match=re.search(r'const byte Cube::'+name+r'[^=]*=\s*(\{.*?\});',source,flags=re.S)
    constants.append('const '+name+'='+match[1].replace('{','[').replace('}',']')+';')

header='''/* GPL-3.0-only. JavaScript adaptation of ShellPuppy/RCube.
 * Upstream: https://github.com/ShellPuppy/RCube
 * Revision: c0e6df125db141eaf0044bf5a39cb54c942cfab2
 * Full original source and license are retained alongside this isolated prototype.
 * Changes: JavaScript state adapter; no file/PNG/CLI facilities; explicit legal
 * commutator expansion replacing source-only optimized center writes; move stream.
 */
import {getPermutation} from 'CORE_IMPORT';
const F=0,R=1,B=2,L=3,U=4,D=5;
const FACE_MAP=[2,1,5,4,0,3],LETTERS=['F','R','B','L','U','D'];
class FaceAccess {
  constructor(cube,id){this.cube=cube;this.id=id;}
  index(r,c,q=0){
    const m=this.cube.R1,t=((0-q)%4+4)%4;
    const [a,b]=t===0?[r,c]:t===1?[c,m-r]:t===2?[m-r,m-c]:[m-c,r];
    if(!Number.isInteger(a)||!Number.isInteger(b)||a<0||b<0||a>m||b>m)throw new Error('Invalid RCube face coordinates');
    return FACE_MAP[this.id]*this.cube.RowSize**2+(m-a)*this.cube.RowSize+b;
  }
  GetRC(r,c){return this.cube.state[this.index(r,c)];}
  GetRCQ(r,c,q){return this.cube.state[this.index(r,c,q)];}
}
'''
class_start='''export class RCube {
  constructor(size,state,options={}){
    if(!Number.isInteger(size)||size<4||size>50||state.length!==6*size*size)throw new RangeError('RCube backend supports sizes4..50');
    this.RowSize=size;this.R1=size-1;this.Mid=size>>1;this.IsEven=size%2===0;
    this.Stage=0;this.QState=0;this.Itteration=0;this.SaveEnabled=false;this.Hours=0;this.MoveCount=0;
    this.ProcessStartTime=performance.now();this.options=options;this.moves=[];this.permutations=new Map();
    this.state=Uint32Array.from(state);this.scratch=new Uint32Array(state.length);this.EdgeState=new Array(12).fill(false);
    this.faces=FACE_MAP.map((_,i)=>new FaceAccess(this,i));this.lastStage=-1;
  }
  SaveCubeState(){}
  CurrentProcessDuration(){return (performance.now()-this.ProcessStartTime)/3600000;}
  IsCubeSolved(){return this.faces.every(face=>{for(let r=0;r<this.RowSize;r++)for(let c=0;c<this.RowSize;c++)if(face.GetRC(r,c)!==face.id)return false;return true;});}
  Move(face,depth,q){
    q=((q%4)+4)%4;if(!q)return;
    if(this.moves.length>=(this.options.maxMoves||200000))throw new Error('RCube move budget exceeded');
    if((this.moves.length&255)===0){
      if(this.options.signal?.aborted)throw new DOMException('Cancelled','AbortError');
      if(performance.now()-this.ProcessStartTime>(this.options.timeoutMs||150000))throw new Error('RCube time budget exceeded');
    }
    if(!Number.isInteger(depth)||depth<0||depth>=this.RowSize)throw new Error('Invalid RCube slice');
    const token=(depth?depth+1:'')+LETTERS[face]+(q===2?'2':q===3?"'":'');
    if(!this.permutations.has(token)){
      const perm=getPermutation(this.RowSize,token),dest=[],source=[];
      for(let i=0;i<perm.length;i++)if(perm[i]!==i){dest.push(i);source.push(perm[i]);}
      this.permutations.set(token,{dest:Uint32Array.from(dest),source:Uint32Array.from(source)});
    }
    const {dest,source}=this.permutations.get(token);
    for(let i=0;i<dest.length;i++)this.scratch[i]=this.state[source[i]];
    for(let i=0;i<dest.length;i++)this.state[dest[i]]=this.scratch[i];
    this.moves.push(token);this.MoveCount++;
    if(this.lastStage!==this.Stage||this.moves.length%1024===0){this.lastStage=this.Stage;this.options.onProgress?.({stage:this.Stage,moves:this.moves.length});}
  }
  OptomizedMovement(stack,count,row,src,dst,sq,dq){
    const map=this.FindCommutatorMap(src,dst),left=cmap[map][2],d=this.IsOpposite(src,dst)?2:1;
    for(let i=0;i<count;i++)this.Move(left,stack[i],-d);
    this.Move(dst,0,1);this.Move(left,row,-d);this.Move(dst,0,-1);
    for(let i=0;i<count;i++)this.Move(left,stack[i],d);
    this.Move(dst,0,1);this.Move(left,row,d);this.Move(dst,0,-1);
  }
'''
# IsEven is a field in the algorithms; it is intentionally not a function.
result=header.replace('CORE_IMPORT',args.core_import)+'\n'.join(constants)+'\n'+class_start+'\n'.join(methods)+'}\n'
result=re.sub(r'(?<![.\w])IsEven\b','this.IsEven',result)
# Optional reduction-only controls. The normal constructive solver keeps its
# original canonical edge targets. Odd-N wing pairing instead targets the
# current true middle edges and never moves those middle slices.
result=result.replace('this.options=options;', 'this.options=options;this.edgeColorMap=options.edgeColorMap||EdgeColorMap;this.skipTrueMidges=options.skipTrueMidges===true;')
result=result.replace('EdgeColorMap[', 'this.edgeColorMap[')
start=result.index('  SolveEdgesEven()')
end=result.index('  FlipRightEdge()',start)
section=result[start:end]
section=section.replace('for (let r = 1; r < this.R1; ++r)\n\t\t\t\t{', 'for (let r = 1; r < this.R1; ++r)\n\t\t\t\t{\n                    if (this.skipTrueMidges && !this.IsEven && r === this.Mid) continue;')
result=result[:start]+section+result[end:]
args.destination.write_text(result,encoding='utf-8')
print('Written JS port:',len(result),'bytes;',len(methods),'algorithm methods')
