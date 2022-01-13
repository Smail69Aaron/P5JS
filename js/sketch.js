// 全画面にしました

// 参考：h_doxasさんのhttps://wgld.org/d/webgl/w083.html です！

// --------------------------------------------------------------- //
// global.

let _gl, gl;

let _node; // RenderSystemSetにアクセスするためのglobal.

let accell = 0; // 加速度
let properFrameCount = 0; // 色を変えるためのカウント変数

let bg, bgTex, base; // 背景用（使うにはテクスチャオブジェクトが必要）

let TEX_SIZE = 512; // 512x512個のパーティクルを用いる

let fb, fb2, flip;
// ダブルバッファリング
// まず最初にfbにvsPとfsPを使って位置と速度を登録。
// 次にfbをmoveに渡して変更してfb2に焼き付ける。
// そしてfb2を使って点描画。
// 最後にfbとfb2をスワップさせる。

// --------------------------------------------------------------- //
// shader.

// dataShader. 最初の位置と速度を設定するところ。
let dataVert=
"precision mediump float;" +
"attribute vec3 aPosition;" + // unique attribute.
"void main(){" +
"  gl_Position = vec4(aPosition, 1.0);" +
"}";

let dataFrag=
"precision mediump float;" +
"uniform float uTexSize;" +
"void main(){" +
"  vec2 p = gl_FragCoord.xy / uTexSize;" + // 0.0～1.0に正規化
// 初期位置と初期速度を設定
"  vec2 pos = (p - 0.5) * 2.0;" + // 位置は-1～1,-1～1で。
"  gl_FragColor = vec4(pos, 0.0, 0.0);" + // 初期速度は0で。
"}";

// bgShader. 背景を描画する。
let bgVert=
"precision mediump float;" +
"attribute vec3 aPosition;" +
"void main(){" +
"  gl_Position = vec4(aPosition, 1.0);" +
"}";

let bgFrag=
"precision mediump float;" +
"uniform sampler2D uTex;" +
"uniform vec2 uResolution;" +
"void main(){" +
"  vec2 p = gl_FragCoord.xy / uResolution.xy;" +
"  p.y = 1.0 - p.y;" +
"  gl_FragColor = texture2D(uTex, p);" +
"}";

// moveShader. 位置と速度の更新をオフスクリーンレンダリングで更新する。
let moveVert =
"precision mediump float;" +
"attribute vec3 aPosition;" +
"void main(){" +
"  gl_Position = vec4(aPosition, 1.0);" +
"}";

let moveFrag =
"precision mediump float;" +
"uniform sampler2D uTex;" +
"uniform float uTexSize;" +
"uniform vec2 uMouse;" +
"uniform bool uMouseFlag;" +
"uniform float uAccell;" +
"const float SPEED = 0.05;" +
"void main(){" +
"  vec2 p = gl_FragCoord.xy / uTexSize;" + // ピクセル位置そのまま
"  vec4 t = texture2D(uTex, p);" +
"  vec2 pos = t.xy;" +
"  vec2 velocity = t.zw;" +
// 更新処理
"  vec2 v = normalize(uMouse - pos) * 0.2;" +
"  vec2 w = normalize(velocity + v);" + // 大きさは常に1で
"  vec4 destColor = vec4(pos + w * SPEED * uAccell, w);" +
// マウスが押されてなければ摩擦で減衰させる感じで
"  if(!uMouseFlag){ destColor.zw = velocity; }" +
"  gl_FragColor = destColor;" +
"}";

// pointShader. 位置情報に基づいて点の描画を行う。
let pointVert =
"precision mediump float;" +
"attribute float aIndex;" +
"uniform sampler2D uTex;" +
"uniform vec2 uResolution;" + // 解像度
"uniform float uTexSize;" + // テクスチャフェッチ用
"uniform float uPointScale;" +
"void main() {" +
// uTexSize * uTexSize個の点を配置
// 0.5を足しているのはきちんとマス目にアクセスするためです
"  float x = (mod(aIndex, uTexSize) + 0.5) / uTexSize;" +
"  float y = (floor(aIndex / uTexSize) + 0.5) / uTexSize;" +
"  vec4 t = texture2D(uTex, vec2(x, y));" +
"  vec2 p = t.xy;" +
"  p *= vec2(min(uResolution.x, uResolution.y)) / uResolution;" +
"  gl_Position = vec4(p, 0.0, 1.0);" +
"  gl_PointSize = 0.1 + uPointScale;" + // 動いてるときだけ大きく
"}";

let pointFrag =
"precision mediump float;" +
"uniform vec4 uAmbient;" + // パーティクルの色
"void main(){" +
"  gl_FragColor = uAmbient;" +
"}";

// --------------------------------------------------------------- //
// setup.

function setup(){
  // _glはp5のwebgl, glはwebglのレンダリングコンテキスト。
  _gl = createCanvas(windowWidth, windowHeight, WEBGL);
  pixelDensity(1);
  gl = _gl.GL;
  
  // 浮動小数点数テクスチャが利用可能かどうかチェック（基本的に可能）
  textureFloatCheck();
  
  // 点描画用のインデックスを格納する配列
  let indices = [];
  // 0～TEX_SIZE*TEX_SIZE-1のindexを放り込む
  for(let i = 0; i < TEX_SIZE * TEX_SIZE; i++){
    indices.push(i);
  }
  // 板ポリの頂点用。これは位置設定、背景、位置更新のすべてで使う
  const positions = [
    -1.0,  1.0,  0.0,
    -1.0, -1.0,  0.0,
     1.0,  1.0,  0.0,
     1.0, -1.0,  0.0
  ];
  
  // nodeを用意
  _node = new RenderSystemSet();

  // dataShader:点の位置と速度の初期設定用
  let dataShader = createShader(dataVert, dataFrag);
  _node.registRenderSystem('data', dataShader);
  _node.use('data', 'plane');
  _node.registAttribute('aPosition', positions, 3);

  // bgShader:背景用
  let bgShader = createShader(bgVert, bgFrag);
  _node.registRenderSystem('bg', bgShader);
  _node.use('bg', 'plane');
  _node.registAttribute('aPosition', positions, 3);
  _node.registUniformLocation('uTex');
  
  // moveShader:点の位置と速度の更新用
  let moveShader = createShader(moveVert, moveFrag);
  _node.registRenderSystem('move', moveShader);
  _node.use('move', 'plane');
  _node.registAttribute('aPosition', positions, 3);
  _node.registUniformLocation('uTex');
  
  // pointShader:点描画用
  let pointShader = createShader(pointVert, pointFrag);
  _node.registRenderSystem('point', pointShader);
  _node.use('point', 'points');
  _node.registAttribute('aIndex', indices, 1);
  _node.registUniformLocation('uTex');
  
  // フレームバッファを用意
  fb = create_framebuffer(TEX_SIZE, TEX_SIZE, gl.FLOAT);
  fb2 = create_framebuffer(TEX_SIZE, TEX_SIZE, gl.FLOAT);
  flip = fb;

  // 位置と速度の初期設定
  defaultRendering();
  
  // 背景の描画（2Dコンテキストで文字）
  prepareBackground();
  bgTex = new p5.Texture(_gl, bg); // シェーダーで使うためtextureを生成
  
  noStroke();
}

// --------------------------------------------------------------- //
// main loop.

function draw(){
  const start = performance.now();
  
  // マウスの値を調整して全画面に合わせる
  const _size = min(width, height);
  const mouse_x = (mouseX / width - 0.5) * 2.0 * width / _size;
  const mouse_y = -(mouseY / height - 0.5) *2.0 * height / _size;
  const mouse_flag = mouseIsPressed;
  
  // ここで位置と速度を更新
  moveRendering(mouse_x, mouse_y, mouse_flag);

  // 背景を描画
  _node.use('bg', 'plane');
  _node.setAttribute();
  _node.setTexture('uTex', bgTex.glTex, 0);
  _node.setUniform("uResolution", [width, height]);
  // ドローコール
  gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
  _node.clear(); // おわったらclear

  // blendの有効化
  gl.enable(gl.BLEND);
  gl.blendFunc(gl.ONE, gl.ONE);  

  // 点描画
  _node.use('point', 'points');
  _node.setAttribute();
  _node.setTexture('uTex', fb2.t, 0);
  const ambient = HSBA_to_RGBA((properFrameCount % 360)/3.6, 100, 80);
  _node.setUniform("uTexSize", TEX_SIZE)
       .setUniform("uPointScale", accell)
       .setUniform("uAmbient", ambient)
       .setUniform("uResolution", [width, height]);
  // ドローコール
  gl.drawArrays(gl.POINTS, 0, TEX_SIZE * TEX_SIZE);
  gl.flush(); // すべての描画が終わったら実行
  _node.clear(); // clearも忘れずに

  gl.disable(gl.BLEND); // blendを消しておく
  
  // swap.
  flip = fb;
  fb = fb2;
  fb2 = flip;
  
  // step.
  properFrameCount++;
  
  // 加速度調整
  if(mouse_flag){ accell = 1.0; }else{ accell *= 0.95; }

  const end = performance.now();
  const performanceRatio = (end - start) * 60 / 1000;
  
  // 背景画像の更新
  bg.image(base, 0, 0);
  bg.text(performanceRatio.toFixed(3), 20, 20);
  bgTex.update();
}

// --------------------------------------------------------------- //
// texture float usability check.

// texture floatが使えるかどうかチェック
function textureFloatCheck(){
  let ext;
  ext = gl.getExtension('OES_texture_float') || gl.getExtension('OES_texture_half_float');
  if(ext == null){
    alert('float texture not supported');
    return;
  }
}

// --------------------------------------------------------------- //
// offscreen rendering.

// オフスクリーンレンダリングで初期の位置と速度を設定
function defaultRendering(){
  // フレームバッファをbind
  gl.bindFramebuffer(gl.FRAMEBUFFER, fb.f);
  // ビューポートをサイズに合わせて設定
  gl.viewport(0, 0, TEX_SIZE, TEX_SIZE);
  
  clear(); // このclearはオフスクリーンに対して適用される
  
  _node.use('data', 'plane');
  _node.setAttribute();
  _node.setUniform('uTexSize', TEX_SIZE);
  // ドローコール
  gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
  _node.clear(); // 終わったらclear

  gl.viewport(0, 0, width, height); // viewportを戻す
  gl.bindFramebuffer(gl.FRAMEBUFFER, null); // bindしたものは常に解除
}

// オフスクリーンレンダリングで位置と速度を更新
function moveRendering(mx, my, mFlag){
  // fbの内容をfb2が受け取って更新した結果を焼き付ける
  // draw内で最後にfbとfb2をswapさせることで逐次更新を実現する
  gl.bindFramebuffer(gl.FRAMEBUFFER, fb2.f);
  gl.viewport(0, 0, TEX_SIZE, TEX_SIZE);
  
  clear();
  
  _node.use('move', 'plane');
  _node.setAttribute();
  _node.setTexture('uTex', fb.t, 0);
  _node.setUniform("uTexSize", TEX_SIZE)
       .setUniform("uAccell", accell)
       .setUniform("uMouseFlag", mFlag)
       .setUniform("uMouse", [mx, my]);
  // ドローコール
  gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
  _node.clear(); // 終わったらclear.
  
  gl.viewport(0, 0, width, height); // viewportを戻す
  gl.bindFramebuffer(gl.FRAMEBUFFER, null); // bindしたものは常に解除
}

// --------------------------------------------------------------- //
// prepare background.

// 背景を用意する（2D描画）
function prepareBackground(){
  bg = createGraphics(width, height);
  base = createGraphics(width, height);

  bg.textSize(16);
  bg.textAlign(LEFT, TOP);
  base.background(0);
  base.textAlign(CENTER, CENTER);
  base.textSize(min(width, height)*0.04);
  base.fill(255);
  base.text("This is GPGPU TEST.", width * 0.5, height * 0.45);
  base.text("Press down the mouse to move", width * 0.5, height * 0.5);
  base.text("Release the mouse to stop", width * 0.5, height * 0.55);
  bg.fill(255);
  bg.image(base, 0, 0);
}

// --------------------------------------------------------------- //
// framebuffer.
// framebufferを生成するための関数

// フレームバッファをオブジェクトとして生成する関数
function create_framebuffer(w, h, format){
  // フォーマットチェック
  let textureFormat = null;
  if(!format){
    textureFormat = gl.UNSIGNED_BYTE;
  }else{
    textureFormat = format;
  }

  // フレームバッファの生成
  let frameBuffer = gl.createFramebuffer();

  // フレームバッファをWebGLにバインド
  gl.bindFramebuffer(gl.FRAMEBUFFER, frameBuffer);

  // 深度バッファ用レンダーバッファの生成とバインド
  let depthRenderBuffer = gl.createRenderbuffer();
  gl.bindRenderbuffer(gl.RENDERBUFFER, depthRenderBuffer);

  // レンダーバッファを深度バッファとして設定
  gl.renderbufferStorage(gl.RENDERBUFFER, gl.DEPTH_COMPONENT16, w, h);

  // フレームバッファにレンダーバッファを関連付ける
  gl.framebufferRenderbuffer(gl.FRAMEBUFFER, gl.DEPTH_ATTACHMENT, gl.RENDERBUFFER, depthRenderBuffer);

  // フレームバッファ用テクスチャの生成
  let fTexture = gl.createTexture();

  // フレームバッファ用のテクスチャをバインド
  gl.bindTexture(gl.TEXTURE_2D, fTexture);

  // フレームバッファ用のテクスチャにカラー用のメモリ領域を確保
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, w, h, 0, gl.RGBA, textureFormat, null);

  // テクスチャパラメータ
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);

  // フレームバッファにテクスチャを関連付ける
  gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, fTexture, 0);

  // 各種オブジェクトのバインドを解除
  gl.bindTexture(gl.TEXTURE_2D, null);
  gl.bindRenderbuffer(gl.RENDERBUFFER, null);
  gl.bindFramebuffer(gl.FRAMEBUFFER, null);

  // オブジェクトを返して終了
  return {f : frameBuffer, d : depthRenderBuffer, t : fTexture};
}

// --------------------------------------------------------------- //
// utility.

// HSBデータを受け取ってRGBAを取得する関数
// デフォではHSBを0～100で指定すると長さ4の配列でRGBが0～1でAが1の
// ものを返す仕様となっている
function HSBA_to_RGBA(h,s,b,a = 1, max_h = 100, max_s = 100, max_b = 100){
  let hue = h * 6 / max_h; // We will split hue into 6 sectors.
  let sat = s / max_s;
  let val = b / max_b;

  let RGB = [];

  if(sat === 0) {
    RGB = [val, val, val]; // Return early if grayscale.
  }else{
    let sector = Math.floor(hue);
    let tint1 = val * (1 - sat);
    let tint2 = val * (1 - sat * (hue - sector));
    let tint3 = val * (1 - sat * (1 + sector - hue));
    switch(sector){
      case 1:
        RGB = [tint2, val, tint1]; break;
      case 2:
        RGB = [tint1, val, tint3]; break;
      case 3:
        RGB = [tint1, tint2, val]; break;
      case 4:
        RGB = [tint3, tint1, val]; break;
      case 5:
        RGB = [val, tint1, tint2]; break;
      default:
        RGB = [val, tint3, tint1]; break;
    }
   }
   return [...RGB, a];
}

// --------------------------------------------------------------- //
// RenderSystem class.
// shaderとprogramとtopologyのsetとあとテクスチャのロケーションのset
// 描画機構

class RenderSystem{
  constructor(_shader){
    this.shader = _shader;
    shader(_shader);
    this.program = _shader._glProgram;
    this.topologies = {};
    this.uniformLocations = {};
  }
  registTopology(topologyName){
    if(this.topologies[topologyName] !== undefined){ return; }
    this.topologies[topologyName] = new Topology();
  }
  getProgram(){
    return this.program;
  }
  getShader(){
    return this.shader;
  }
  getTopology(topologyName){
    return this.topologies[topologyName];
  }
  registUniformLocation(uniformName){
    if(this.uniformLocations[uniformName] !== undefined){ return; }
    this.uniformLocations[uniformName] = gl.getUniformLocation(this.program, uniformName);
  }
  setTexture(uniformName, _texture, locationID){
    gl.activeTexture(gl.TEXTURE0 + locationID);
    gl.bindTexture(gl.TEXTURE_2D, _texture);
    gl.uniform1i(this.uniformLocations[uniformName], locationID);
  }
}

// --------------------------------------------------------------- //
// RenderSystemSet class.
// RenderSystemを登録して名前で切り替えられるようになっている
// さらにRenderSystemごとにTopology（geometryに相当する）を複数登録して
// それも切り替えできるようにする
// このコードでは1つずつしか使わないのでその切り替えはしないけど

class RenderSystemSet{
  constructor(){
    this.renderSystems = {};
    this.currentRenderSystem = undefined;
    this.currentShader = undefined;
    this.currentTopology = undefined;
    this.useTextureFlag = false;
  }
  registRenderSystem(renderSystemName, _shader){
    if(this.renderSystems[renderSystemName] !== undefined){ return; }
    this.renderSystems[renderSystemName] = new RenderSystem(_shader);
  }
  use(renderSystemName, topologyName){
    // まとめてやれた方がいい場合もあるので
    if(this.renderSystems[renderSystemName] == undefined){ return; }
    this.useRenderSystem(renderSystemName);
    this.registTopology(topologyName); // 登録済みなら何もしない
    this.useTopology(topologyName);
  }
  useRenderSystem(renderSystemName){
    // 使うプログラムを決める
    this.currentRenderSystem = this.renderSystems[renderSystemName];
    this.currentShader = this.currentRenderSystem.getShader();
    this.currentShader.useProgram();
  }
  registTopology(topologyName){
    // currentProgramに登録するので事前にuseが必要ですね
    this.currentRenderSystem.registTopology(topologyName);
  }
  useTopology(topologyName){
    // たとえば複数のトポロジーを使い回す場合ここだけ切り替える感じ
    this.currentTopology = this.currentRenderSystem.getTopology(topologyName);
  }
  registAttribute(attributeName, data, stride){
    this.currentTopology.registAttribute(this.currentRenderSystem.getProgram(), attributeName, data, stride);
  }
  setAttribute(){
    // その時のtopologyについて準備する感じ
    this.currentTopology.setAttribute();
  }
  registIndexBuffer(data, type){
    this.currentTopology.registIndexBuffer(data, type);
  }
  bindIndexBuffer(){
    this.currentTopology.bindIndexBuffer();
  }
  registUniformLocation(uniformName){
    this.currentRenderSystem.registUniformLocation(uniformName);
  }
  setTexture(uniformName, _texture, locationID){
    this.currentRenderSystem.setTexture(uniformName, _texture, locationID);
    this.useTextureFlag = true; // 1回でも使った場合にtrue
  }
  setUniform(uniformName, data){
    this.currentShader.setUniform(uniformName, data);
    return this;
  }
  clear(){
    // 描画の後処理
    // topologyを切り替える場合にも描画後にこれを行なったりする感じ
    // 同じプログラム、トポロジーで点描画や線描画を行う場合などは
    // その限りではない（レアケースだけどね）
    this.currentTopology.clear();
    // textureを使っている場合はbindを解除する
    if(this.useTextureFlag){
      gl.bindTexture(gl.TEXTURE_2D, null);
      this.useTextureFlag = false;
    }
  }
  // delete系関数はそのときのtopologyに対して呼び出す
  deleteIBO(){
    this.currentTopology.deleteIBO();
  }
  deleteAttribute(attributeName){
    this.currentTopology.deleteAttribute(attributeName);
  }
  initialize(){
    this.currentTopology.initialize();
  }
}

// --------------------------------------------------------------- //
// Topology class.
// シェーダーごとに設定
// Geometryだと名前がかぶるのでTopologyにした（一応）
// 描画に必要な情報の一揃え。

class Topology{
  constructor(){
    this.attributes = {}; // Object.keysでフェッチ。delete a[name]で削除。
    this.ibo = undefined;
  }
  registAttribute(program, attributeName, data, stride){
    let attr = {};
    attr.vbo = Topology.create_vbo(data);
    attr.location = gl.getAttribLocation(program, attributeName);
    attr.stride = stride;
    this.attributes[attributeName] = attr;
  }
  setAttribute(){
    Topology.set_attribute(this.attributes);
  }
  registIndexBuffer(data, type){
    this.ibo = Topology.create_ibo(data, type);
  }
  bindIndexBuffer(){
    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, this.ibo);
  }
  clear(){
    // 描画が終わったらbindを解除する
    gl.bindBuffer(gl.ARRAY_BUFFER, null);
    if(this.ibo !== undefined){ gl.bindBuffer(gl.ELEMENT_BUFFER, null); }
  }
  deleteIBO(){
    if(this.ibo == undefined){ return; }
    gl.deleteBuffer(this.ibo);
  }
  deleteAttribute(attributeName){
    if(this.attributes[attributeName] == undefined){ return; }
    gl.deleteBuffer(this.attributes[attributeName].vbo);
    delete this.attributes[attributeName];
  }
  initialize(){
    // バッファの解放
    this.deleteIBO();
    for(let name of Object.keys(this.attributes)){
      this.deleteAttribute(name);
    }
  }
  static create_vbo(data){
    // バッファオブジェクトの生成
    let vbo = gl.createBuffer();

    // バッファをバインドする
    gl.bindBuffer(gl.ARRAY_BUFFER, vbo);

    // バッファにデータをセット
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(data), gl.STATIC_DRAW);

    // バッファのバインドを無効化
    gl.bindBuffer(gl.ARRAY_BUFFER, null);

    // 生成したVBOを返して終了
    return vbo;
  }
  static set_attribute(attributes){
    // 引数として受け取った配列を処理する
    for(let name of Object.keys(attributes)){
      const attr = attributes[name];
      // バッファをバインドする
      gl.bindBuffer(gl.ARRAY_BUFFER, attr.vbo);

      // attributeLocationを有効にする
      gl.enableVertexAttribArray(attr.location);

      // attributeLocationを通知し登録する
      gl.vertexAttribPointer(attr.location, attr.stride, gl.FLOAT, false, 0, 0);
    }
  }
}
