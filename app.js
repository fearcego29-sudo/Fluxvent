// ==========================================
// CONFIGURACIÓN DE SUPABASE
// ==========================================
const SUPABASE_URL = 'https://kmvqpjttcygsqkmqrpmw.supabase.co';
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImttdnFwanR0Y3lnc3FrbXFycG13Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3OTE2NTg2ODYsImV4cCI6MjEwNzIzNDY4Nn0.ohvfPExDPhapJFyc0_Lz42H9BVrHTKKUj2CdWxDbuNs';
const supabaseClient = supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

let empresaActiva = null;
let productosGlobal = [];
let ventasGlobal = [];
let carrito = [];
let graficaVentasChart = null;
let rolActivo = 'admin'; // 'admin' o 'cajero'

document.addEventListener('DOMContentLoaded', async () => {
  inicializarGrafica();
  await verificarSesion();
});

// ==========================================
// 1. SESIÓN Y PERMISOS DE ROL
// ==========================================
function aplicarPermisosRol() {
  const esCajero = rolActivo === 'cajero';

  // 1. Ocultar o mostrar el dashboard de métricas e ingresos
  const dashboard = document.querySelector('section.lg\\:col-span-5');
  if (dashboard) dashboard.style.display = esCajero ? 'none' : 'block';

  // 2. Ocultar o mostrar el botón de "Agregar Producto"
  const btnAgregar = document.querySelector('button[onclick="abrirModalProducto()"]');
  if (btnAgregar) btnAgregar.style.display = esCajero ? 'none' : 'flex';

  // 3. Expandir la pantalla del POS a pantalla completa si es Cajero
  const posCol = document.querySelector('section.lg\\:col-span-7');
  if (posCol) {
    if (esCajero) {
      posCol.classList.remove('lg:col-span-7');
      posCol.classList.add('lg:col-span-12');
    } else {
      posCol.classList.remove('lg:col-span-12');
      posCol.classList.add('lg:col-span-7');
    }
  }
}

async function verificarSesion() {
  const modal = document.getElementById('modal-auth');

  const { data: { session } } = await supabaseClient.auth.getSession();
  if (session) {
    const { data: empresa } = await supabaseClient
      .from('empresas')
      .select('*')
      .eq('usuario_id', session.user.id)
      .single();

    if (empresa) {
      empresaActiva = empresa;
      
      // Ocultar modal garantizado
      if (modal) {
        modal.classList.add('hidden');
        modal.style.display = 'none';
      }

      document.getElementById('nombre-empresa').textContent = `${empresa.nombre} (${rolActivo.toUpperCase()})`;
      
      aplicarPermisosRol();
      await cargarCatalogo();

      if (rolActivo === 'admin') {
        await cargarMetricasDashboard();
      }
      return;
    }
  }
  
  // Si no hay sesión, mostrar modal
  if (modal) {
    modal.classList.remove('hidden');
    modal.style.display = 'flex';
  }
}

async function registrarEmpresa() {
  const nombre = document.getElementById('auth-empresa').value.trim();
  const email = document.getElementById('auth-email').value.trim();
  const password = document.getElementById('auth-password').value.trim();

  if (!nombre || !email || !password) return alert('Por favor completa todos los campos.');

  const { data: authData, error: authErr } = await supabaseClient.auth.signUp({ email, password });
  if (authErr) return alert('Error al registrar usuario: ' + authErr.message);

  const { data: empresa, error: empErr } = await supabaseClient
    .from('empresas')
    .insert({ nombre, usuario_id: authData.user.id, plan: 'PRO' })
    .select()
    .single();

  if (empErr) return alert('Error al crear la empresa: ' + empErr.message);

  empresaActiva = empresa;
  rolActivo = 'admin'; // Quien registra siempre es Administrador
  await verificarSesion();
}

async function iniciarSesion() {
  const email = document.getElementById('auth-email').value.trim();
  const password = document.getElementById('auth-password').value.trim();
  
  // Guardar el rol seleccionado (Administrador o Cajero)
  rolActivo = document.getElementById('auth-rol')?.value || 'admin';

  const { error } = await supabaseClient.auth.signInWithPassword({ email, password });
  if (error) return alert('Credenciales incorrectas: ' + error.message);

  await verificarSesion();
}

async function cerrarSesion() {
  await supabaseClient.auth.signOut();
  location.reload();
}

// ==========================================
// 2. CATÁLOGO, BUSCADOR & CÓDIGO ÚNICO
// ==========================================
async function cargarCatalogo() {
  if (!empresaActiva) return;
  const { data: productos } = await supabaseClient
    .from('productos')
    .select('*')
    .eq('empresa_id', empresaActiva.id)
    .order('nombre', { ascending: true });

  productosGlobal = productos || [];
  renderizarProductos(productosGlobal);
  actualizarKpiStockBajo();
}

function renderizarProductos(lista) {
  const container = document.getElementById('grid-productos');
  container.innerHTML = '';

  if (lista.length === 0) {
    container.innerHTML = `<p class="col-span-full text-center text-xs text-zinc-500 py-6">Sin productos encontrados.</p>`;
    return;
  }

  const esCajero = rolActivo === 'cajero';

  lista.forEach(p => {
    const sinStock = p.stock <= 0;
    const stockBajo = p.stock <= (p.stock_minimo || 5) && !sinStock;

    let colorStock = 'text-emerald-400';
    let textoStock = `${p.stock} un.`;

    if (sinStock) {
      colorStock = 'text-red-400 font-bold';
      textoStock = 'Agotado';
    } else if (stockBajo) {
      colorStock = 'text-amber-400 font-semibold';
      textoStock = `${p.stock} un. (Bajo)`;
    }

    // Si es cajero, ocultar botones de editar y borrar producto
    const accionesAdmin = esCajero ? '' : `
      <button onclick="editarProducto(${p.id})" class="text-zinc-500 hover:text-brand-400 p-1"><i data-lucide="edit-2" class="w-3 h-3"></i></button>
      <button onclick="eliminarProducto(${p.id})" class="text-zinc-500 hover:text-red-400 p-1"><i data-lucide="trash-2" class="w-3 h-3"></i></button>
    `;

    container.innerHTML += `
      <div class="bg-zinc-950/80 border ${sinStock ? 'border-red-500/20 opacity-50' : 'border-white/10 hover:border-brand-500/50'} p-3.5 rounded-2xl transition flex flex-col justify-between group relative">
        <div onclick="${sinStock ? '' : `agregarAlCarrito(${p.id})`}" class="cursor-pointer">
          <h4 class="font-semibold text-xs text-zinc-200 group-hover:text-brand-400 transition line-clamp-1">${p.nombre}</h4>
          <p class="text-[10px] text-zinc-500">Cód: ${p.codigo_barras || 'N/A'}</p>
        </div>
        <div class="flex items-center justify-between mt-3 pt-2 border-t border-white/5">
          <span class="font-extrabold text-xs text-white">$${parseFloat(p.precio).toFixed(2)}</span>
          <div class="flex items-center gap-1.5">
            <span class="text-[10px] ${colorStock}">${textoStock}</span>
            ${accionesAdmin}
          </div>
        </div>
      </div>
    `;
  });
  lucide.createIcons();
}

function filtrarProductos() {
  const query = document.getElementById('input-buscar').value.toLowerCase().trim();
  const filtrados = productosGlobal.filter(p => 
    p.nombre.toLowerCase().includes(query) || 
    (p.codigo_barras && p.codigo_barras.toLowerCase().includes(query))
  );
  renderizarProductos(filtrados);
}

function abrirModalProducto() {
  document.getElementById('prod-id').value = '';
  document.getElementById('prod-nombre').value = '';
  document.getElementById('prod-precio').value = '';
  document.getElementById('prod-stock').value = '';
  document.getElementById('prod-codigo').value = '';
  document.getElementById('modal-producto-titulo').textContent = 'Agregar Producto';
  document.getElementById('modal-producto').classList.remove('hidden');
}

function cerrarModalProducto() {
  document.getElementById('modal-producto').classList.add('hidden');
}

function editarProducto(id) {
  const p = productosGlobal.find(item => item.id === id);
  if (!p) return;
  document.getElementById('prod-id').value = p.id;
  document.getElementById('prod-nombre').value = p.nombre;
  document.getElementById('prod-precio').value = p.precio;
  document.getElementById('prod-stock').value = p.stock;
  document.getElementById('prod-codigo').value = p.codigo_barras || '';
  document.getElementById('modal-producto-titulo').textContent = 'Editar Producto';
  document.getElementById('modal-producto').classList.remove('hidden');
}

async function guardarProducto() {
  const id = document.getElementById('prod-id').value;
  const nombre = document.getElementById('prod-nombre').value.trim();
  const precio = parseFloat(document.getElementById('prod-precio').value);
  const stock = parseInt(document.getElementById('prod-stock').value);
  const codigo_barras = document.getElementById('prod-codigo').value.trim();

  if (!nombre || isNaN(precio) || isNaN(stock)) return alert('Por favor completa los datos requeridos.');

  if (codigo_barras) {
    const duplicado = productosGlobal.find(p => p.codigo_barras === codigo_barras && p.id != id);
    if (duplicado) {
      return alert(`⚠️ El código de barras "${codigo_barras}" ya pertenece al producto: ${duplicado.nombre}. Usar uno diferente.`);
    }
  }

  if (id) {
    await supabaseClient.from('productos').update({ nombre, precio, stock, codigo_barras }).eq('id', id);
  } else {
    await supabaseClient.from('productos').insert({ empresa_id: empresaActiva.id, nombre, precio, stock, codigo_barras });
  }

  cerrarModalProducto();
  await cargarCatalogo();
}

async function eliminarProducto(id) {
  if (!confirm('¿Eliminar este producto del inventario?')) return;
  await supabaseClient.from('productos').delete().eq('id', id);
  await cargarCatalogo();
}

// ==========================================
// 3. CARRITO & COBRO
// ==========================================
function agregarAlCarrito(id) {
  const prod = productosGlobal.find(p => p.id === id);
  if (!prod) return;
  const item = carrito.find(i => i.id === id);
  if (item) {
    if (item.cantidad + 1 > prod.stock) return alert('Stock insuficiente');
    item.cantidad++;
  } else {
    carrito.push({ id: prod.id, nombre: prod.nombre, precio: parseFloat(prod.precio), cantidad: 1, stockMax: prod.stock });
  }
  renderizarCarrito();
}

function cambiarCantidad(id, delta) {
  const item = carrito.find(i => i.id === id);
  if (!item) return;
  item.cantidad += delta;
  if (item.cantidad <= 0) carrito = carrito.filter(i => i.id !== id);
  renderizarCarrito();
}

function vaciarCarrito() {
  carrito = [];
  renderizarCarrito();
}

function renderizarCarrito() {
  const tbody = document.getElementById('tabla-carrito');
  const totalElem = document.getElementById('total-ticket');
  const btnCobrar = document.getElementById('btn-cobrar');
  tbody.innerHTML = '';
  let total = 0;

  if (carrito.length === 0) {
    tbody.innerHTML = `<tr><td colspan="4" class="text-center py-8 text-zinc-500">Ticket vacío.</td></tr>`;
    totalElem.textContent = '$0.00';
    btnCobrar.disabled = true;
    return;
  }

  carrito.forEach(i => {
    const sub = i.precio * i.cantidad;
    total += sub;
    tbody.innerHTML += `
      <tr>
        <td class="py-2 font-medium text-white">${i.nombre}</td>
        <td class="py-2 text-center">
          <button onclick="cambiarCantidad(${i.id}, -1)" class="px-1.5 text-zinc-400 font-bold">-</button>
          <span class="font-bold text-white">${i.cantidad}</span>
          <button onclick="cambiarCantidad(${i.id}, 1)" class="px-1.5 text-zinc-400 font-bold">+</button>
        </td>
        <td class="py-2 text-right font-semibold text-white">$${sub.toFixed(2)}</td>
        <td class="py-2 text-right"><button onclick="cambiarCantidad(${i.id}, -${i.cantidad})" class="text-zinc-500 hover:text-red-400"><i data-lucide="trash-2" class="w-3.5 h-3.5"></i></button></td>
      </tr>
    `;
  });

  totalElem.innerHTML = `$${total.toFixed(2)} <span class="text-xs font-normal text-zinc-500">MXN</span>`;
  btnCobrar.disabled = false;
  lucide.createIcons();
}

async function procesarVenta() {
  if (carrito.length === 0) return;
  const totalVenta = carrito.reduce((acc, i) => acc + (i.precio * i.cantidad), 0);

  const { data: venta } = await supabaseClient
    .from('ventas')
    .insert({ empresa_id: empresaActiva.id, total: totalVenta })
    .select()
    .single();

  for (const item of carrito) {
    await supabaseClient.from('detalle_ventas').insert({ 
      venta_id: venta.id, 
      producto_id: item.id, 
      cantidad: item.cantidad, 
      precio_unitario: item.precio, 
      subtotal: item.precio * item.cantidad 
    });
    const prod = productosGlobal.find(p => p.id === item.id);
    if (prod) {
      await supabaseClient.from('productos').update({ stock: Math.max(0, prod.stock - item.cantidad) }).eq('id', item.id);
    }
  }

  vaciarCarrito();
  await cargarCatalogo();
  if (rolActivo === 'admin') {
    await cargarMetricasDashboard();
  }
  alert('✅ Venta registrada con éxito. Puedes reimprimir el ticket desde el historial.');
}

// ==========================================
// 4. METRICAS & IMPRESIÓN
// ==========================================
async function cargarMetricasDashboard() {
  if (!empresaActiva) return;

  const { data: todasVentas } = await supabaseClient
    .from('ventas')
    .select('id, total, creado_en')
    .eq('empresa_id', empresaActiva.id)
    .order('creado_en', { ascending: true });

  ventasGlobal = (todasVentas || []).map((v, index) => ({
    ...v,
    folioInterno: index + 1
  }));

  const hoyStr = new Date().toLocaleDateString('sv-SE');

  const totalHoy = ventasGlobal.reduce((acc, v) => {
    const fechaVentaStr = new Date(v.creado_en).toLocaleDateString('sv-SE');
    if (fechaVentaStr === hoyStr) {
      return acc + parseFloat(v.total || 0);
    }
    return acc;
  }, 0);

  const elVentasHoy = document.getElementById('kpi-ventas-hoy');
  if (elVentasHoy) elVentasHoy.textContent = `$${totalHoy.toFixed(2)}`;

  const ultimasCinco = [...ventasGlobal].reverse().slice(0, 5);
  renderizarUltimasVentas(ultimasCinco);
  actualizarGraficaVentas(ultimasCinco);
}

function actualizarKpiStockBajo() {
  const conStockBajo = productosGlobal.filter(p => p.stock <= (p.stock_minimo || 5));
  const elStockBajo = document.getElementById('kpi-stock-bajo');
  if (elStockBajo) elStockBajo.textContent = `${conStockBajo.length} items`;
}

function renderizarUltimasVentas(ventas) {
  const list = document.getElementById('lista-ultimas-ventas');
  if (!list) return;
  list.innerHTML = '';

  if (ventas.length === 0) {
    list.innerHTML = `<p class="text-zinc-500 text-center py-4">Sin ventas registradas.</p>`;
    return;
  }

  ventas.forEach(v => {
    const hora = new Date(v.creado_en).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    list.innerHTML += `
      <div class="flex items-center justify-between p-2.5 rounded-xl bg-zinc-950/60 border border-white/5">
        <div class="flex items-center gap-2">
          <div class="w-2 h-2 rounded-full bg-emerald-400"></div>
          <span class="font-medium text-zinc-300">Ticket #${v.folioInterno}</span>
          <span class="text-[10px] text-zinc-500">${hora}</span>
        </div>
        <div class="flex items-center gap-3">
          <span class="font-bold text-white">$${parseFloat(v.total).toFixed(2)}</span>
          <button onclick="reimprimirTicket(${v.id}, ${v.folioInterno}, ${v.total}, '${v.creado_en}')" class="text-zinc-400 hover:text-brand-400 transition" title="Imprimir Ticket">
            <i data-lucide="printer" class="w-4 h-4"></i>
          </button>
        </div>
      </div>
    `;
  });
  lucide.createIcons();
}

async function reimprimirTicket(ventaId, folioInterno, total, fechaIso) {
  const { data: detalles } = await supabaseClient
    .from('detalle_ventas')
    .select('cantidad, precio_unitario, subtotal, productos(nombre)')
    .eq('venta_id', ventaId);

  document.getElementById('ticket-nombre-empresa').textContent = empresaActiva.nombre;
  document.getElementById('ticket-fecha').textContent = new Date(fechaIso).toLocaleString();
  document.getElementById('ticket-folio').textContent = `FOLIO: #${folioInterno}`;
  document.getElementById('ticket-total').textContent = parseFloat(total).toFixed(2);

  const itemsContainer = document.getElementById('ticket-items');
  itemsContainer.innerHTML = '';

  (detalles || []).forEach(d => {
    const nombreProd = d.productos ? d.productos.nombre : 'Producto';
    itemsContainer.innerHTML += `
      <div class="flex justify-between text-[10px]">
        <span>${d.cantidad}x ${nombreProd}</span>
        <span>$${parseFloat(d.subtotal).toFixed(2)}</span>
      </div>
    `;
  });

  document.getElementById('seccion-ticket').classList.remove('hidden');
  window.print();
  document.getElementById('seccion-ticket').classList.add('hidden');
}

function inicializarGrafica() {
  const canvas = document.getElementById('graficaVentas');
  if (!canvas) return;
  const ctx = canvas.getContext('2d');
  graficaVentasChart = new Chart(ctx, {
    type: 'bar',
    data: { labels: [], datasets: [{ data: [], backgroundColor: '#6366f1', borderRadius: 8, maxBarThickness: 32 }] },
    options: { responsive: true, maintainAspectRatio: false, plugins: { legend: { display: false } }, scales: { x: { grid: { display: false }, ticks: { color: '#71717a' } }, y: { grid: { color: 'rgba(255, 255, 255, 0.05)' }, ticks: { color: '#71717a' } } } }
  });
}

function actualizarGraficaVentas(ventas) {
  if (!graficaVentasChart) return;
  const rev = [...ventas].reverse();
  graficaVentasChart.data.labels = rev.map(v => `#${v.folioInterno}`);
  graficaVentasChart.data.datasets[0].data = rev.map(v => parseFloat(v.total));
  graficaVentasChart.update();
}