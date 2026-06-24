const SUPABASE_URL = 'https://aogxafkugxpcahevjudg.supabase.co';
const SUPABASE_ANON_KEY = 'sb_publishable_HO4X6eWI757QbeedU2LLfw_ikknLNdf';

// Đổi tên biến thành supabaseClient để không trùng với biến supabase mặc định của CDN
const supabaseClient = supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

// Các thẻ UI
const loginSection = document.getElementById('loginSection');
const appSection = document.getElementById('appSection');

// 1. Kiểm tra xem user đã đăng nhập từ trước chưa (nhớ phiên)
async function checkSession() {
    const { data: { session } } = await supabaseClient.auth.getSession();
    if (session) {
        showApp();
    } else {
        showLogin();
    }
}
checkSession(); // Chạy ngay khi mở trang

// 2. Xử lý nút Đăng nhập
document.getElementById('btnLogin').addEventListener('click', async () => {
    const email = document.getElementById('email').value;
    const password = document.getElementById('password').value;
    const errorMsg = document.getElementById('loginError');

    // Gọi API của Supabase để xác thực
    const { data, error } = await supabaseClient.auth.signInWithPassword({
        email: email,
        password: password
    });

    if (error) {
        errorMsg.classList.remove('hidden');
    } else {
        errorMsg.classList.add('hidden');
        showApp();
    }
});

// 3. Xử lý nút Đăng xuất
document.getElementById('btnLogout').addEventListener('click', async () => {
    await supabaseClient.auth.signOut();
    showLogin();
});

// Hàm đổi giao diện
function showLogin() {
    loginSection.classList.remove('hidden');
    appSection.classList.add('hidden');
}

function showApp() {
    loginSection.classList.add('hidden');
    appSection.classList.remove('hidden');
}

// ----------------------------------------------------
// CODE LOGIC TRA CỨU
// ----------------------------------------------------
let currentRequestId = null;

document.getElementById('btnSearch').addEventListener('click', async () => {
    const ma_qhns = document.getElementById('ma_qhns').value;
    const tu_ngay = document.getElementById('tu_ngay').value;
    const den_ngay = document.getElementById('den_ngay').value;

    document.getElementById('resultBody').innerHTML = '<tr><td colspan="9" class="text-center p-4">Đang gửi yêu cầu...</td></tr>';

    // 1. Tạo request mới trên Supabase
    const { data, error } = await supabaseClient
        .from('TraCuuRequests')
        .insert([{ ma_qhns, tu_ngay, den_ngay }])
        .select();

    if (error) {
        alert("Lỗi tạo yêu cầu!");
        console.error(error);
        return;
    }
    
    currentRequestId = data[0].request_id;

    // 2. Lắng nghe thay đổi dữ liệu Realtime (Chỉ lắng nghe ID vừa tạo)
    listenToRealtime(currentRequestId);
});

function listenToRealtime(reqId) {
    supabaseClient.channel('custom-all-channel')
    .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'ChiTietChungTu', filter: `request_id=eq.${reqId}` },
        (payload) => {
            // Mỗi khi BE xử lý xong 1 dòng hoặc insert dòng mới, FE tự động gọi hàm render lại bảng
            fetchAndRender(reqId);
        }
    )
    .subscribe();
}

async function fetchAndRender(reqId) {
    const { data } = await supabaseClient.from('ChiTietChungTu').select('*').eq('request_id', reqId);
    
    const tbody = document.getElementById('resultBody');
    tbody.innerHTML = ''; // Xoá cũ

    if (!data || data.length === 0) {
         tbody.innerHTML = '<tr><td colspan="9" class="text-center p-4 text-gray-500 text-sm">Hệ thống đang truy xuất dữ liệu, vui lòng chờ...</td></tr>';
         return;
    }

    data.forEach((row, index) => {
        let actionHtml = '';
        if (row.file_status === 'completed') {
            const safeFileName = `${row.so_chung_tu}.pdf`;
            actionHtml = `
                <div class="flex items-center justify-center space-x-1 sm:space-x-2">
                    <button onclick="viewPDFBlob('${row.file_url}')" class="text-blue-600 font-semibold hover:text-blue-800 hover:underline cursor-pointer transition">Xem</button>
                    <span class="text-gray-300">|</span>
                    <a href="${row.file_url}?download=${safeFileName}" class="text-green-600 font-semibold hover:text-green-800 hover:underline cursor-pointer transition">Tải</a>
                </div>
            `;
        } else if (row.file_status === 'no_file') {
            actionHtml = `<span class="text-gray-400 italic">Trống</span>`;
        } else if (row.file_status === 'dvc_error' || row.file_status === 'supabase_error') {
            actionHtml = `<span class="text-red-500 font-semibold">Lỗi</span> - <button onclick="retryFile('${row.id}')" class="font-bold cursor-pointer hover:text-red-700">🔄 Tải lại</button>`;
        } else {
            actionHtml = `<span class="text-gray-500 italic">⏳ Đang tải...</span>`;
        }

        const tr = document.createElement('tr');
        // bg-white quan trọng để khi cột sticky trượt qua các cột khác không bị đè chữ
        tr.className = "text-[11px] sm:text-xs bg-white hover:bg-blue-50 transition-colors";
        
        tr.innerHTML = `
            <td class="p-2 border text-center">${index + 1}</td>
            <td class="p-2 border font-medium">${row.so_chung_tu || ''}</td>
            
            <td class="border p-0">
                <div class="p-2 w-full h-full overflow-hidden text-ellipsis whitespace-nowrap" title="${row.chi_tiet || ''}">
                    ${row.chi_tiet || ''}
                </div>
            </td>
            
            <td class="p-2 border text-center">${row.sotk_so || ''}</td>
            <td class="p-2 border text-center">${row.ngay_hoan_thanh || ''}</td>
            <td class="p-2 border text-center">${row.ngay_tabmis_thanh_toan || ''}</td>
            
            <td class="border p-0">
                <div class="p-2 w-full h-full overflow-hidden text-ellipsis whitespace-nowrap" title="${row.ten_trang_thai || ''}">
                    ${row.ten_trang_thai || ''}
                </div>
            </td>
            
            <td class="p-2 border font-mono text-right text-green-700 font-semibold">${row.tong_so_tien ? Number(row.tong_so_tien).toLocaleString('vi-VN') : ''}</td>
            
            <td class="p-2 border-l border-b text-center whitespace-nowrap sticky right-0 bg-inherit shadow-[-2px_0_5px_rgba(0,0,0,0.05)] z-10">
                ${actionHtml}
            </td>
        `;
        tbody.appendChild(tr);
    });
}

// Hàm Retry
window.retryFile = async (id) => {
    await supabaseClient.from('ChiTietChungTu').update({ file_status: 'retry_pending' }).eq('id', id);
};

// Bổ sung xử lý lỗi vào hàm fetch Blob
window.viewPDFBlob = async (url) => {
    try {
        const response = await fetch(url);
        
        // Kiểm tra xem request có thành công không
        if (!response.ok) {
            throw new Error(`Mã lỗi HTTP: ${response.status}`);
        }
        
        const blob = await response.blob();
        
        // Cảnh báo nếu dữ liệu tải về không mang định dạng PDF
        if (blob.type !== 'application/pdf' && !blob.type.includes('pdf')) {
            console.warn("Cảnh báo: Tệp lấy về có thể không phải PDF hợp lệ. Loại MIME:", blob.type);
        }

        const file = new Blob([blob], { type: 'application/pdf' });
        const fileURL = URL.createObjectURL(file);
        
        window.open(fileURL, '_blank');
    } catch (error) {
        alert("Không thể mở file. Có thể dữ liệu gốc bị hỏng hoặc cấu hình bảo mật chặn tải (CORS).");
        console.error("Chi tiết lỗi Blob:", error);
    }
};

// ----------------------------------------------------
// TỰ ĐỘNG ĐĂNG XUẤT SAU 15 PHÚT KHÔNG THAO TÁC
// ----------------------------------------------------
function setupInactivityTimeout() {
    let timeoutTimer;
    const INACTIVITY_TIME = 15 * 60 * 1000; // 15 phút

    function resetTimer() {
        clearTimeout(timeoutTimer);
        timeoutTimer = setTimeout(autoLogout, INACTIVITY_TIME);
    }

    async function autoLogout() {
        // Chỉ đăng xuất nếu đang có phiên đăng nhập
        const { data: { session } } = await supabaseClient.auth.getSession();
        if (session) {
            await supabaseClient.auth.signOut();
            showLogin();
            alert("Bạn đã không thao tác trong 15 phút. Hệ thống tự động đăng xuất để đảm bảo an toàn.");
        }
    }

    // Lắng nghe các sự kiện thao tác của người dùng
    window.onload = resetTimer;
    document.onmousemove = resetTimer;
    document.onkeydown = resetTimer;
    document.onclick = resetTimer;
    document.onscroll = resetTimer;
}

// Kích hoạt tính năng
setupInactivityTimeout();
