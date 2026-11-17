/* GPL-3.0-only. JavaScript adaptation of ShellPuppy/RCube.
 * Upstream: https://github.com/ShellPuppy/RCube
 * Revision: c0e6df125db141eaf0044bf5a39cb54c942cfab2
 * Full original source and license are retained alongside this isolated prototype.
 * Changes: JavaScript state adapter; no file/PNG/CLI facilities; explicit legal
 * commutator expansion replacing source-only optimized center writes; move stream.
 */
import {getPermutation} from '../../core.mjs';
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
const EdgeColorMap=[
	5,2,
	2,3,
	2,4,
	2,1,
	5,1,
	4,1,
	4,3,
	5,3,
	0,5,
	0,1,
	0,4,
	0,3
];
const cmap=[
	[0,1,4,5,3,3],
	[0,2,3,1,0,2],
	[0,3,5,4,1,1],
	[0,4,3,1,0,0],
	[0,5,1,3,2,2],
	[1,0,5,4,1,1],
	[1,2,4,5,3,3],
	[1,3,5,4,1,1],
	[1,4,0,2,0,1],
	[1,5,2,0,2,1],
	[2,0,1,3,0,2],
	[2,1,5,4,1,1],
	[2,3,4,5,3,3],
	[2,4,1,3,0,2],
	[2,5,3,1,2,0],
	[3,0,4,5,3,3],
	[3,1,4,5,3,3],
	[3,2,5,4,1,1],
	[3,4,2,0,0,3],
	[3,5,0,2,2,3],
	[4,0,1,3,2,2],
	[4,1,2,0,3,2],
	[4,2,3,1,0,2],
	[4,3,0,2,1,2],
	[4,5,0,2,1,3],
	[5,0,3,1,0,0],
	[5,1,0,2,3,0],
	[5,2,1,3,2,0],
	[5,3,2,0,1,0],
	[5,4,2,0,1,3]
];
const corners=[
	[4,0,3],
	[4,3,2],
	[4,1,2],
	[4,0,1],
	[5,3,2],
	[5,0,3],
	[5,0,1],
	[5,1,2],
];
const EdgeRotMap=[
	[8,11,10,9],
	[3,4,9,5],	
	[0,3,2,1],	
	[1,6,11,7],	
	[2,5,10,6],	
	[0,7,8,4]	
];
export class RCube {
  constructor(size,state,options={}){
    if(!Number.isInteger(size)||size<4||size>50||state.length!==6*size*size)throw new RangeError('RCube backend supports sizes4..50');
    this.RowSize=size;this.R1=size-1;this.Mid=size>>1;this.IsEven=size%2===0;
    this.Stage=0;this.QState=0;this.Itteration=0;this.SaveEnabled=false;this.Hours=0;this.MoveCount=0;
    this.ProcessStartTime=performance.now();this.options=options;this.edgeColorMap=options.edgeColorMap||EdgeColorMap;this.skipTrueMidges=options.skipTrueMidges===true;this.moves=[];this.permutations=new Map();
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
  Solve() {

	
	this.ProcessStartTime = performance.now();

	if (this.RowSize == 1)
	{
		this.MoveCount++;
		for (let i = 0; i < 6; ++i) this.faces[i].SetRC(0, 0, i);
		return;
	}

	if (this.RowSize == 2)
	{
		this.SolveCorners();
		return;
	}

	this.AlignTrueCenters();

	if (this.Stage <= 14)
	{
		this.SolveCenters();
	}

	if (this.Stage == 15)
	{
		this.SaveCubeState();
		this.SolveCorners();
	}

	if (this.Stage == 16)
	{
		if (this.IsEven)
		{
			this.SolveEdgesEven();
		}
		else
		{
			this.SolveEdgesOdd();
			if (!this.IsCubeSolved()) this.SolveEdgesOdd();
		}
	}

	this.Hours += this.CurrentProcessDuration();

  }

  SolveCenters() {


	if (this.RowSize < 4)
	{
		this.Stage = 15;
		return;
	}

	if (this.Stage == 0)
	{
		this.PushCenterPieces(F, R, R);
		this.Stage++;
	}

	if (this.Stage == 1)
	{
		this.SaveCubeState();
		this.PushCenterPieces(U, R, R);
		this.Stage++;
	}

	if (this.Stage == 2)
	{
		this.SaveCubeState();
		this.PushCenterPieces(B, R, R);
		this.Stage++;
	}

	if (this.Stage == 3)
	{
		this.SaveCubeState();
		this.PushCenterPieces(L, R, R);
		this.Stage++;
	}

	if (this.Stage == 4)
	{
		this.SaveCubeState();
		this.PushCenterPieces(D, R, R);
		this.Stage++;
	}

	if (this.Stage == 5)
	{
		this.SaveCubeState();
		this.PushCenterPieces(U, L, L);
		this.Stage++;
	}

	if (this.Stage == 6)
	{
		this.SaveCubeState();
		this.PushCenterPieces(D, L, L);
		this.Stage++;
	}

	if (this.Stage == 7)
	{
		this.SaveCubeState();
		this.PushCenterPieces(B, L, L);
		this.Stage++;
	}

	if (this.Stage == 8)
	{
		this.SaveCubeState();
		this.PushCenterPieces(F, L, L);
		this.Stage++;
	}

	if (this.Stage == 9)
	{
		this.SaveCubeState();
		this.PushCenterPieces(B, F, F);
		this.Stage++;
	}

	if (this.Stage == 10)
	{
		this.SaveCubeState();
		this.PushCenterPieces(U, F, F);
		this.Stage++;
	}

	if (this.Stage == 11)
	{
		this.SaveCubeState();
		this.PushCenterPieces(D, F, F);
		this.Stage++;
	}

	if (this.Stage == 12)
	{
		this.SaveCubeState();
		this.PushCenterPieces(U, D, D);
		this.Stage++;
	}

	if (this.Stage == 13)
	{
		this.SaveCubeState();
		this.PushCenterPieces(B, D, D);
		this.Stage++;
	}

	if (this.Stage == 14)
	{
		this.SaveCubeState();
		this.PushCenterPieces(U, B, B);
		this.Stage++;
	}

  }

  AlignTrueCenters() {

	if (this.IsEven) return; 

	let q;

	for (let i = 0; i < 6; i++)
	{
		if (this.faces[i].GetRC(this.Mid, this.Mid) == F) q = i;
	}

	if (q == U) this.Move(L, this.Mid, 1);
	if (q == D) this.Move(L, this.Mid, -1);
	if (q == L) this.Move(U, this.Mid, -1);
	if (q == R) this.Move(U, this.Mid, 1);
	if (q == B) this.Move(U, this.Mid, 2);

	for (let i = 0; i < 6; i++)
	{
		if (this.faces[i].GetRC(this.Mid, this.Mid) == U) q = i;
	}

	if (q == D) this.Move(F, this.Mid, 2);
	if (q == L) this.Move(F, this.Mid, 1);
	if (q == R) this.Move(F, this.Mid, -1);

  }

  IsOpposite(src,dst) {

	if ((src == 0 && dst == 2) || (src == 2 && dst == 0)) return true;
	if ((src == 1 && dst == 3) || (src == 3 && dst == 1)) return true;
	if ((src == 4 && dst == 5) || (src == 5 && dst == 4)) return true;

	return false;

  }

  PushCenterPieces(src,dst,color) {

	
	let map = this.FindCommutatorMap(src, dst);

	let srcl = cmap[map][2];			
	let sq = -cmap[map][4];		
	let dq = -cmap[map][5];		
	let d = 1;

	if (this.IsOpposite(src, dst)) d = 2;

	let mstack = new Uint32Array(this.Mid);		

	let stkptr = 0;
	let pieces = 0;
	let start = this.Mid;

	if (this.Itteration > 0) start = this.Itteration;

	for (let quadrant = this.QState; quadrant < 4; ++quadrant)
	{
		this.QState = quadrant;

		for (let r = start; r < this.R1; ++r)
		{
			this.Itteration = r;

			if (this.SaveEnabled)
			{
				
				if (this.CurrentProcessDuration() >= 1.0)
				{
					this.SaveCubeState();
				}
			}

			while (true)
			{
				pieces = 0;
				stkptr = 0;
				for (let c = 1; c < this.Mid; ++c)
				{
					if (this.faces[src].GetRCQ(r, c, sq) == color)
					{
						pieces++;
						if (this.faces[dst].GetRCQ(r, c, dq) != color)
						{
							mstack[stkptr++] = c;
						}
					}
				}

				if (pieces == 0) break;

				if (stkptr <= 0)
				{
					this.Move(dst, 0, 1);
					continue;
				}

				this.OptomizedMovement(mstack, stkptr, r, src, dst, sq, dq);

			}
		}

		start = this.Mid;

		this.Move(src, 0, 1);
	}

	this.QState = 0;
	this.Itteration = 0;
	

  }

  FindCommutatorMap(src,dst) {

	for (let i = 0; i < 30; i++)
		if (cmap[i][0] == src && cmap[i][1] == dst) return i;
	return 0;

  }

  SolveEdgesOdd() {

	let c0, c1;
	let r0, r1;
	let l0, l1;

	let mstack = new Uint32Array(this.RowSize);	
	let mptr;
	let found;

	this.EdgeState.fill(false);

	for (let de = 0; de < 12; ++de)
	{
		
		this.SetDestinationEdge(de, true);

		[r0,r1]=this.GetRightEdgeColors(this.Mid);

		for (let i = 0; i < 12; i++)
		{
			c0 = this.edgeColorMap[2 * i];
			c1 = this.edgeColorMap[2 * i + 1];

			if (r0 == c1 && r1 == c0)
			{
				
				this.Move(D, this.Mid, 1);
				this.FlipRightEdge();
				this.Move(D, this.Mid, -1);
				this.UnFlipRightEdge();
			}
		}

		this.SetDestinationEdge(de, false);
	}

	for (let de = 0; de < 12; ++de)
	{
		
		this.SetDestinationEdge(de, true);

		c0 = this.edgeColorMap[2 * de];
		c1 = this.edgeColorMap[2 * de + 1];

		for (let se = 0; se < 12; ++se)
		{
			
			if (this.EdgeState[se]) continue;

			this.SetSourceEdge(se, true);

			[r0,r1]=this.GetRightEdgeColors(this.Mid);
			if (r0 == c1 && r1 == c0 && de < 11)
			{
				
				this.Move(D, this.Mid, 1);
				this.FlipRightEdge();
				this.Move(D, this.Mid, -1);
				this.UnFlipRightEdge();
			}

			do {
				found = false;

				mptr = 0;
				for (let r = 1; r < this.R1; ++r)
				{
					[l0,l1]=this.GetLeftEdgeColors(r);
					[r0,r1]=this.GetRightEdgeColors(r);

					if ((l0 == c0 && l1 == c1) || (l0 == c1 && l1 == c0))
					{
						
						if (!((r0 == c0 && r1 == c1) || (r0 == c1 && r1 == c0)))
						{
							if (r != this.Mid) mstack[mptr++] = r;
						}
					}
				}

				if (mptr > 0)
				{
					found = true;
					for (let i = 0; i < mptr; ++i)
					{
						if (mstack[i] < this.Mid)
						{
							this.Move(D, mstack[i], 1);
							this.Move(D, this.R1 - mstack[i], 1);
						}
					}
					this.FlipRightEdge();
					for (let i = 0; i < mptr; ++i)
					{
						if (mstack[i] < this.Mid) 	this.Move(D, mstack[i], -1);
					}
					this.UnFlipRightEdge();
					for (let i = 0; i < mptr; ++i)
					{
						if (mstack[i] < this.Mid) 	this.Move(D, this.R1 - mstack[i], -1);
					}

					for (let i = 0; i < mptr; ++i)
					{
						if (mstack[i] >= this.Mid)
						{
							this.Move(D, mstack[i], 1);
							this.Move(D, this.R1 - mstack[i], 1);
						}
					}
					this.FlipRightEdge();
					for (let i = 0; i < mptr; ++i)
					{
						if (mstack[i] >= this.Mid) 	this.Move(D, mstack[i], -1);
					}
					this.UnFlipRightEdge();
					for (let i = 0; i < mptr; ++i)
					{
						if (mstack[i] >= this.Mid) 	this.Move(D, this.R1 - mstack[i], -1);
					}

				}

				mptr = 0;
				for (let r = 1; r < this.R1; ++r)
				{
					[l0,l1]=this.GetLeftEdgeColors(r);
					[r0,r1]=this.GetRightEdgeColors(r);

					if ((l0 == c0 && l1 == c1) || (l0 == c1 && l1 == c0))
					{
						
						if (((r0 == c0 && r1 == c1) || (r0 == c1 && r1 == c0)))
						{
							if (r != this.Mid) mstack[mptr++] = r;
						}
					}
				}

				if (mptr > 0)
				{
					found = true;
					this.FlipRightEdge();
					for (let i = 0; i < mptr; ++i) { this.Move(D, mstack[i], 1); }
					this.UnFlipRightEdge();
					for (let i = 0; i < mptr; ++i) { this.Move(D, mstack[i], -1); }
				}

				[l0,l1]=this.GetLeftEdgeColors(this.Mid);
				if (l0 == c0 && l1 == c1)
				{
					this.FlipLeftEdge();
					this.MoveCenterEdge(false);
					this.UnFlipLeftEdge();
				}

				if (l0 == c1 && l1 == c0) this.MoveCenterEdge(false);

			} while (found);  

			this.SetSourceEdge(se, false);
		}

		for (let r = 1; r < this.Mid; ++r)
		{
			[r0,r1]=this.GetRightEdgeColors(r);
			if (r0 == c1 && r1 == c0) this.FixParity(r);
		}

		this.SetDestinationEdge(de, false);

		this.EdgeState[de] = true;
	}


  }

  SolveEdgesEven() {

	let c0, c1;
	let r0, r1;
	let l0, l1;

	let mstack = new Uint32Array(this.RowSize);	
	let mptr;
	let found;

	this.EdgeState.fill(false);

	for (let de = 0; de < 12; ++de)
	{
		
		this.SetDestinationEdge(de, true);

		c0 = this.edgeColorMap[2 * de];
		c1 = this.edgeColorMap[2 * de + 1];

		for (let se = 0; se < 12; ++se)
		{
			
			if (this.EdgeState[se]) continue;

			this.SetSourceEdge(se, true);

			do {
				found = false;

				mptr = 0;
				for (let r = 1; r < this.R1; ++r)
				{
                    if (this.skipTrueMidges && !this.IsEven && r === this.Mid) continue;
					[l0,l1]=this.GetLeftEdgeColors(r);
					[r0,r1]=this.GetRightEdgeColors(r);

					if ((l0 == c0 && l1 == c1) || (l0 == c1 && l1 == c0))
					{
						
						if (!((r0 == c0 && r1 == c1) || (r0 == c1 && r1 == c0)))
						{
							mstack[mptr++] = r;
						}
					}
				}

				if (mptr > 0)
				{
					found = true;
					for (let i = 0; i < mptr; ++i)
					{
						if (mstack[i] < this.Mid)
						{
							this.Move(D, mstack[i], 1);
							this.Move(D, this.R1 - mstack[i], 1);
						}
					}
					this.FlipRightEdge();
					for (let i = 0; i < mptr; ++i)
					{
						if (mstack[i] < this.Mid) 	this.Move(D, mstack[i], -1);
					}
					this.UnFlipRightEdge();
					for (let i = 0; i < mptr; ++i)
					{
						if (mstack[i] < this.Mid) 	this.Move(D, this.R1 - mstack[i], -1);
					}

					for (let i = 0; i < mptr; ++i)
					{
						if (mstack[i] >= this.Mid)
						{
							this.Move(D, mstack[i], 1);
							this.Move(D, this.R1 - mstack[i], 1);
						}
					}
					this.FlipRightEdge();
					for (let i = 0; i < mptr; ++i)
					{
						if (mstack[i] >= this.Mid) 	this.Move(D, mstack[i], -1);
					}
					this.UnFlipRightEdge();
					for (let i = 0; i < mptr; ++i)
					{
						if (mstack[i] >= this.Mid) 	this.Move(D, this.R1 - mstack[i], -1);
					}

				}

				mptr = 0;
				for (let r = 1; r < this.R1; ++r)
				{
                    if (this.skipTrueMidges && !this.IsEven && r === this.Mid) continue;
					[l0,l1]=this.GetLeftEdgeColors(r);
					[r0,r1]=this.GetRightEdgeColors(r);

					if ((l0 == c0 && l1 == c1) || (l0 == c1 && l1 == c0))
					{
						
						if (((r0 == c0 && r1 == c1) || (r0 == c1 && r1 == c0)))
						{
							mstack[mptr++] = r;
						}
					}
				}

				if (mptr > 0 && mptr < this.RowSize)
				{
					found = true;
					this.FlipRightEdge();
					for (let i = 0; i < mptr; i++) { this.Move(D, mstack[i], 1); }
					this.UnFlipRightEdge();
					for (let i = 0; i < mptr; i++) { this.Move(D, mstack[i], -1); }
				}

			} while (found);  

			this.SetSourceEdge(se, false);
		}

		for (let r = 1; r < this.Mid; ++r)
		{
			[r0,r1]=this.GetRightEdgeColors(r);
			if (r0 == c1 && r1 == c0) this.FixParity(r);
		}

		this.SetDestinationEdge(de, false);

		this.EdgeState[de] = true;
	}


  }

  FlipRightEdge() {

	this.Move(R, 0, 1);
	this.UpdateEdgeRotation(R, 1);
	this.Move(U, 0, 1);
	this.UpdateEdgeRotation(U, 1);
	this.Move(R, 0, -1);
	this.UpdateEdgeRotation(R, -1);
	this.Move(F, 0, 1);
	this.UpdateEdgeRotation(F, 1);
	this.Move(R, 0, -1);
	this.UpdateEdgeRotation(R, -1);
	this.Move(F, 0, -1);
	this.UpdateEdgeRotation(F, -1);
	this.Move(R, 0, 1);
	this.UpdateEdgeRotation(R, 1);

  }

  UnFlipRightEdge() {

	this.Move(R, 0, -1);
	this.UpdateEdgeRotation(R, -1);
	this.Move(F, 0, 1);
	this.UpdateEdgeRotation(F, 1);
	this.Move(R, 0, 1);
	this.UpdateEdgeRotation(R, 1);
	this.Move(F, 0, -1);
	this.UpdateEdgeRotation(F, -1);
	this.Move(R, 0, 1);
	this.UpdateEdgeRotation(R, 1);
	this.Move(U, 0, -1);
	this.UpdateEdgeRotation(U, -1);
	this.Move(R, 0, -1);
	this.UpdateEdgeRotation(R, -1);

  }

  FlipLeftEdge() {

	this.Move(L, 0, -1);
	this.UpdateEdgeRotation(L, -1);
	this.Move(U, 0, -1);
	this.UpdateEdgeRotation(U, -1);
	this.Move(L, 0, 1);
	this.UpdateEdgeRotation(L, 1);
	this.Move(F, 0, -1);
	this.UpdateEdgeRotation(F, -1);
	this.Move(L, 0, 1);
	this.UpdateEdgeRotation(L, 1);
	this.Move(F, 0, 1);
	this.UpdateEdgeRotation(F, 1);
	this.Move(L, 0, -1);
	this.UpdateEdgeRotation(L, -1);

  }

  UnFlipLeftEdge() {

	this.Move(L, 0, 1);
	this.UpdateEdgeRotation(L, 1);
	this.Move(F, 0, -1);
	this.UpdateEdgeRotation(F, -1);
	this.Move(L, 0, -1);
	this.UpdateEdgeRotation(L, -1);
	this.Move(F, 0, 1);
	this.UpdateEdgeRotation(F, 1);
	this.Move(L, 0, -1);
	this.UpdateEdgeRotation(L, -1);
	this.Move(U, 0, 1);
	this.UpdateEdgeRotation(U, 1);
	this.Move(L, 0, 1);
	this.UpdateEdgeRotation(L, 1);

  }

  MoveCenterEdge(flipped) {


	let q = -1;

	if (!this.EdgeState[6]) q = 1;
	if (!this.EdgeState[2]) q = 2;
	if (!this.EdgeState[5]) q = 3;
	if (!this.EdgeState[10]) q = 0;

	if (q >= 0)
	{
		if (q > 0)	this.Move(U, 0, -q);

		this.Move(L, this.Mid, 2);
		this.Move(F, 0, 1);
		this.Move(L, this.Mid, -1);
		this.Move(F, 0, 2);
		this.Move(L, this.Mid, 1);
		this.Move(F, 0, 1);
		this.Move(L, this.Mid, 2);

		if (q > 0)	this.Move(U, 0, q);

		return;
	}

	q = -1;

	if (!this.EdgeState[7]) q = 1;
	if (!this.EdgeState[0]) q = 2;
	if (!this.EdgeState[4]) q = 3;
	if (!this.EdgeState[8]) q = 0;

	if (q >= 0)
	{
		if (q > 0)	this.Move(D, 0, q);

		this.Move(L, this.Mid, 2);
		this.Move(F, 0, -1);
		this.Move(L, this.Mid, 1);
		this.Move(F, 0, 2);
		this.Move(L, this.Mid, -1);
		this.Move(F, 0, -1);
		this.Move(L, this.Mid, 2);

		if (q > 0)	this.Move(D, 0, -q);

		return;
	}

	if (!flipped)
	{
		this.Move(B, 0, 1);
		this.UpdateEdgeRotation(B, 1);
		this.MoveCenterEdge(true);
		this.Move(B, 0, -1);
		this.UpdateEdgeRotation(B, -1);
	}

  }

  GetLeftEdgeColors(row,l0,l1) {

	l0 = this.faces[L].GetRC(row, this.R1);
	l1 = this.faces[F].GetRC(row, 0);

return [l0,l1];

  }

  GetRightEdgeColors(row,r0,r1) {

	r0 = this.faces[F].GetRC(row, this.R1);
	r1 = this.faces[R].GetRC(row, 0);

return [r0,r1];

  }

  FixParity(row) {

	this.Move(D, row, -1);
	this.Move(R, 0, 2);
	this.Move(U, row, 1);
	this.Move(F, 0, 2);
	this.Move(U, row, -1);
	this.Move(F, 0, 2);
	this.Move(D, row, 2);
	this.Move(R, 0, 2);
	this.Move(D, row, 1);
	this.Move(R, 0, 2);
	this.Move(D, row, -1);
	this.Move(R, 0, 2);
	this.Move(F, 0, 2);
	this.Move(D, row, 2);
	this.Move(F, 0, 2);

  }

  SetDestinationEdge(edge,set) {

	if (set)
	{
		switch (edge)
		{
		case 0: 
			this.Move(D, 0, -1); this.UpdateEdgeRotation(D, -1);
			this.Move(R, 0, 1);  this.UpdateEdgeRotation(R, 1);
			break;
		case 1: 
			this.Move(B, 0, 2);  this.UpdateEdgeRotation(B, 2);
			this.Move(R, 0, 2);  this.UpdateEdgeRotation(R, 2);
			break;
		case 2:
			this.Move(B, 0, -1);	 this.UpdateEdgeRotation(B, -1);
			this.Move(R, 0, 2); this.UpdateEdgeRotation(R, 2);
			break;
		case 3:
			this.Move(R, 0, 2); this.UpdateEdgeRotation(R, 2);
			break;
		case 4:
			this.Move(R, 0, 1); this.UpdateEdgeRotation(R, 1);
			break;
		case 5:
			this.Move(R, 0, -1); this.UpdateEdgeRotation(R, -1);
			break;
		case 6:
			this.Move(U, 0, 2); this.UpdateEdgeRotation(U, 2);
			this.Move(R, 0, -1); this.UpdateEdgeRotation(R, -1);
			break;
		case 7:
			this.Move(D, 0, 2); this.UpdateEdgeRotation(D, 2);
			this.Move(R, 0, 1); this.UpdateEdgeRotation(R, 1);
			break;
		case 8:
			this.Move(F, 0, -1); this.UpdateEdgeRotation(F, -1);
			break;
		case 9:
			break;
		case 10:
			this.Move(F, 0, 1); this.UpdateEdgeRotation(F, 1);
			break;
		case 11:
			this.Move(F, 0, 2); this.UpdateEdgeRotation(F, 2);
			break;
		}
		return;
	}

	if (!set)
	{
		switch (edge)
		{
		case 0: 
			this.Move(R, 0, -1); this.UpdateEdgeRotation(R, -1);
			this.Move(D, 0, 1); this.UpdateEdgeRotation(D, 1);
			break;
		case 1: 
			this.Move(R, 0, 2); this.UpdateEdgeRotation(R, 2);
			this.Move(B, 0, 2); this.UpdateEdgeRotation(B, 2);
			break;
		case 2:
			this.Move(R, 0, 2); this.UpdateEdgeRotation(R, 2);
			this.Move(B, 0, 1); this.UpdateEdgeRotation(B, 1);
			break;
		case 3:
			this.Move(R, 0, 2); this.UpdateEdgeRotation(R, 2);
			break;
		case 4:
			this.Move(R, 0, -1); this.UpdateEdgeRotation(R, -1);
			break;
		case 5:
			this.Move(R, 0, 1); this.UpdateEdgeRotation(R, 1);
			break;
		case 6:
			this.Move(R, 0, 1); this.UpdateEdgeRotation(R, 1);
			this.Move(U, 0, 2); this.UpdateEdgeRotation(U, 2);
			break;
		case 7:
			this.Move(R, 0, -1); this.UpdateEdgeRotation(R, -1);
			this.Move(D, 0, 2); this.UpdateEdgeRotation(D, 2);
			break;
		case 8:
			this.Move(F, 0, 1); this.UpdateEdgeRotation(F, 1);
			break;
		case 9:
			break;
		case 10:
			this.Move(F, 0, -1); this.UpdateEdgeRotation(F, -1);
			break;
		case 11:
			this.Move(F, 0, 2); this.UpdateEdgeRotation(F, 2);
			break;
		}
	}

  }

  SetSourceEdge(edge,set) {

	if (set)
	{
		switch (edge)
		{
		case 0: 
			this.Move(D, 0, 1);
			this.UpdateEdgeRotation(D, 1);
			this.Move(L, 0, -1);
			this.UpdateEdgeRotation(L, -1);
			break;
		case 1: 
			this.Move(L, 0, 2);
			this.UpdateEdgeRotation(L, 2);
			break;
		case 2:
			this.Move(U, 0, -1);
			this.UpdateEdgeRotation(U, -1);
			this.Move(L, 0, 1);
			this.UpdateEdgeRotation(L, 1);
			break;
		case 3:
			this.Move(B, 0, 2);
			this.UpdateEdgeRotation(B, 2);
			this.Move(L, 0, 2);
			this.UpdateEdgeRotation(L, 2);
			break;
		case 4:
			this.Move(D, 0, 2);
			this.UpdateEdgeRotation(D, 2);
			this.Move(L, 0, -1);
			this.UpdateEdgeRotation(L, -1);
			break;
		case 5:
			this.Move(U, 0, 2);
			this.UpdateEdgeRotation(U, 2);
			this.Move(L, 0, 1);
			this.UpdateEdgeRotation(L, 1);
			break;
		case 6:
			this.Move(L, 0, 1);
			this.UpdateEdgeRotation(L, 1);
			break;
		case 7:
			this.Move(L, 0, -1);
			this.UpdateEdgeRotation(L, -1);
			break;
		case 8:
			this.Move(D, 0, -1);
			this.UpdateEdgeRotation(D, -1);
			this.Move(L, 0, -1);
			this.UpdateEdgeRotation(L, -1);
			break;
		case 9:
			break;
		case 10:
			this.Move(U, 0, 1);
			this.UpdateEdgeRotation(U, 1);
			this.Move(L, 0, 1);
			this.UpdateEdgeRotation(L, 1);
			break;
		case 11:
			break;
		}
		return;
	}

	if (!set)
	{
		switch (edge)
		{
		case 0: 
			this.Move(L, 0, 1); this.UpdateEdgeRotation(L, 1);
			this.Move(D, 0, -1); this.UpdateEdgeRotation(D, -1);
			break;
		case 1: 
			this.Move(L, 0, 2); this.UpdateEdgeRotation(L, 2);
			break;
		case 2:
			this.Move(L, 0, -1); this.UpdateEdgeRotation(L, -1);
			this.Move(U, 0, 1); this.UpdateEdgeRotation(U, 1);
			break;
		case 3:
			this.Move(L, 0, 2); this.UpdateEdgeRotation(L, 2);
			this.Move(B, 0, 2); this.UpdateEdgeRotation(B, 2);
			break;
		case 4:
			this.Move(L, 0, 1); this.UpdateEdgeRotation(L, 1);
			this.Move(D, 0, 2); this.UpdateEdgeRotation(D, 2);
			break;
		case 5:
			this.Move(L, 0, -1); this.UpdateEdgeRotation(L, -1);
			this.Move(U, 0, 2); this.UpdateEdgeRotation(U, 2);
			break;
		case 6:
			this.Move(L, 0, -1); this.UpdateEdgeRotation(L, -1);
			break;
		case 7:
			this.Move(L, 0, 1); this.UpdateEdgeRotation(L, 1);
			break;
		case 8:
			this.Move(L, 0, 1); this.UpdateEdgeRotation(L, 1);
			this.Move(D, 0, 1); this.UpdateEdgeRotation(D, 1);
			break;
		case 9:
			break;
		case 10:
			this.Move(L, 0, -1); this.UpdateEdgeRotation(L, -1);
			this.Move(U, 0, -1); this.UpdateEdgeRotation(U, -1);
			break;
		case 11:
			break;
		}
	}

  }

  UpdateEdgeRotation(faceid,steps) {

	let e = EdgeRotMap[faceid];

	if (steps > 0)
	{
		for (let i = 0; i < steps; ++i)
		{
			let tmp = this.EdgeState[e[3]];

			this.EdgeState[e[3]] = this.EdgeState[e[2]];
			this.EdgeState[e[2]] = this.EdgeState[e[1]];
			this.EdgeState[e[1]] = this.EdgeState[e[0]];
			this.EdgeState[e[0]] = tmp;
		}
	}

	if (steps < 0)
	{
		for (let i = 0; i < Math.abs(steps); ++i)
		{
			let tmp = this.EdgeState[e[0]];
			this.EdgeState[e[0]] = this.EdgeState[e[1]];
			this.EdgeState[e[1]] = this.EdgeState[e[2]];
			this.EdgeState[e[2]] = this.EdgeState[e[3]];
			this.EdgeState[e[3]] = tmp;
		}
	}


  }

  SolveCorners() {

	let pos = 0;

	for (let i = 0; i < 4; ++i)
	{
		pos = this.FindCorner(i);

		switch (pos)
		{
		case 0:
			this.Move(L, 0, 1);
			this.Move(D, 0, 1);
			this.Move(L, 0, -1);
			break;
		case 1:
			this.Move(L, 0, -1);
			this.Move(D, 0, 2);
			this.Move(L, 0, 1);
			break;
		case 2:
			this.Move(R, 0, 1);
			this.Move(D, 0, 1);
			this.Move(R, 0, -1);
			this.Move(D, 0, 2);
			break;
		case 3:
			this.Move(R, 0, -1);
			this.Move(D, 0, -1);
			this.Move(R, 0, 1);
			this.Move(D, 0, 1);
			break;
		case 4:
			this.Move(D, 0, 2);
			break;
		case 5:
			this.Move(D, 0, 1);
			break;
		case 6:
			break;
		case 7:
			this.Move(D, 0, -1);
			break;
		}

		pos = this.FindCorner(i);

		while (!(pos == 3 && this.faces[U].GetRC(0, this.R1) == U))
		{
			this.Move(R, 0, -1);
			this.Move(D, 0, -1);
			this.Move(R, 0, 1);
			this.Move(D, 0, 1);
			pos = this.FindCorner(i);
		}

		if (i < 3) this.Move(U, 0, -1);

	}

	this.Move(L, 0, 2);
	this.Move(R, 0, 2);

	pos = this.FindCorner(4);
	if (pos == 0) this.Move(U, 0, -1);
	if (pos == 1) this.Move(U, 0, 2);
	if (pos == 2) this.Move(U, 0, 1);

	let c = new Array(3).fill(0);

	c[this.FindCorner(5)] = 5;
	c[this.FindCorner(6)] = 6;
	c[this.FindCorner(7)] = 7;

	if (c[0] == 5 && c[1] == 6 && c[2] == 7)
	{
		this.Move(U, 0, 1);
	}

	if (c[0] == 5 && c[1] == 7 && c[2] == 6)
	{
		this.Move(U, 0, 1);
		this.FlipCorners();
		this.FlipCorners();
		this.Move(U, 0, -1);
	}

	if (c[0] == 6 && c[1] == 5 && c[2] == 7)
	{
		this.Move(U, 0, 2);
		this.FlipCorners();
		this.FlipCorners();
		this.Move(U, 0, 2);
	}

	if (c[0] == 6 && c[1] == 7 && c[2] == 5)
	{
		this.FlipCorners();
		this.FlipCorners();
		this.Move(U, 0, 1);
	}

	if (c[0] == 7 && c[1] == 5 && c[2] == 6)
	{
		this.FlipCorners();
		this.Move(U, 0, 1);
	}

	if (c[0] == 7 && c[1] == 6 && c[2] == 5)
	{
		this.FlipCorners();
		this.Move(U, 0, -1);
		this.FlipCorners();
		this.Move(U, 0, -1);
	}

	for (let i = 0; i < 4; ++i)
	{

		while (this.faces[U].GetRC(0, this.R1) != D)
		{
			this.Move(R, 0, -1);
			this.Move(D, 0, -1);
			this.Move(R, 0, 1);
			this.Move(D, 0, 1);
		}
		this.Move(U, 0, 1);
	}

	this.Move(L, 0, 2);
	this.Move(R, 0, 2);

	this.Stage++;

  }

  FlipCorners() {

	this.Move(U, 0, 1);
	this.Move(R, 0, 1);
	this.Move(U, 0, -1);
	this.Move(L, 0, -1);
	this.Move(U, 0, 1);
	this.Move(R, 0, -1);
	this.Move(U, 0, -1);
	this.Move(L, 0, 1);

  }

  GetCorner(cr,c0,c1,c2) {

	switch (cr)
	{
	case 0:
		c0 = this.faces[U].GetRC(0, 0);
		c1 = this.faces[F].GetRC(this.R1, 0);
		c2 = this.faces[L].GetRC(this.R1, this.R1);
		return [c0,c1,c2];
	case 1:
		c0 = this.faces[U].GetRC(this.R1, 0);
		c1 = this.faces[L].GetRC(this.R1, 0);
		c2 = this.faces[B].GetRC(this.R1, this.R1);
		return [c0,c1,c2];
	case 2:
		c0 = this.faces[U].GetRC(this.R1, this.R1);
		c1 = this.faces[R].GetRC(this.R1, this.R1);
		c2 = this.faces[B].GetRC(this.R1, 0);
		return [c0,c1,c2];
	case 3:
		c0 = this.faces[U].GetRC(0, this.R1);
		c1 = this.faces[F].GetRC(this.R1, this.R1);
		c2 = this.faces[R].GetRC(this.R1, 0);
		return [c0,c1,c2];
	case 4:
		c0 = this.faces[D].GetRC(0, 0);
		c1 = this.faces[L].GetRC(0, 0);
		c2 = this.faces[B].GetRC(0, this.R1);
		return [c0,c1,c2];
	case 5:
		c0 = this.faces[D].GetRC(this.R1, 0);
		c1 = this.faces[F].GetRC(0, 0);
		c2 = this.faces[L].GetRC(0, this.R1);
		return [c0,c1,c2];
	case 6:
		c0 = this.faces[D].GetRC(this.R1, this.R1);
		c1 = this.faces[F].GetRC(0, this.R1);
		c2 = this.faces[R].GetRC(0, 0);
		return [c0,c1,c2];
	case 7:
		c0 = this.faces[D].GetRC(0, this.R1);
		c1 = this.faces[R].GetRC(0, this.R1);
		c2 = this.faces[B].GetRC(0, 0);
		return [c0,c1,c2];

	}

  }

  IsCorner(cr,c0,c1,c2) {

	let b0, b1, b2;

	[b0,b1,b2]=this.GetCorner(cr);

	return	(c0 == b0 || c0 == b1 || c0 == b2) &&
		(c1 == b0 || c1 == b1 || c1 == b2) &&
		(c2 == b0 || c2 == b1 || c2 == b2);


  }

  FindCorner(cr) {

	for (let i = 0; i < 8; ++i)
	{
		if (this.IsCorner(i, corners[cr][0], corners[cr][1], corners[cr][2])) return i;
	}

	return -1;

  }
}
